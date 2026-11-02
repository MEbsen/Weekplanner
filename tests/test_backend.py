"""Backend boundary tests without importing a full Home Assistant installation."""
import ast
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path("custom_components/week_planner/__init__.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)

def functions(*names, **environment):
    nodes = []
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            clone = ast.parse(ast.get_source_segment(SOURCE, node)).body[0]
            clone.decorator_list = []
            nodes.append(clone)
    namespace = dict(HomeAssistant=object, ConfigEntry=object, datetime=datetime,
                     timezone=timezone, timedelta=timedelta, asyncio=asyncio, **environment)
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])),
                 "<backend-boundary>", "exec"), namespace)
    return namespace

class Connection:
    def __init__(self):
        self.result = None
        self.error = None
    def send_result(self, _id, value):
        self.result = value
    def send_error(self, _id, code, message):
        self.error = (code, message)

class BackendTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_native_panel_card_is_migrated_without_losing_metadata(self):
        ns = functions("_migrate_native_dashboard_config",
                       _DASHBOARD_CARD_TYPE="custom:week-planner-dashboard-card")
        original = {"title": "Family", "views": [{
            "title": "Week", "path": "planner", "panel": True,
            "cards": [{"type": "custom:week-planner-card", "scroll_mode": "fixed", "height": 900},
                      {"type": "markdown", "content": "Keep me"}],
        }, {"title": "Custom", "cards": [{"type": "custom:week-planner-card"}]}]}
        migrated = ns["_migrate_native_dashboard_config"](original)
        self.assertEqual(migrated["views"][0]["cards"][0]["type"], "custom:week-planner-dashboard-card")
        self.assertEqual(original["views"][0]["cards"][0]["type"], "custom:week-planner-card")
        self.assertEqual(migrated["views"][0]["cards"][0]["height"], 900)
        self.assertEqual(migrated["views"][0]["cards"][1], original["views"][0]["cards"][1])
        self.assertEqual(migrated["views"][1], original["views"][1])
        self.assertEqual(migrated["title"], "Family")
        self.assertIs(ns["_migrate_native_dashboard_config"](migrated), migrated)

    async def test_native_migration_is_persisted_once_and_save_failure_does_not_reset_dashboard(self):
        ns = functions("_migrate_native_dashboard_config", "_async_load_native_dashboard",
                       _DASHBOARD_CARD_TYPE="custom:week-planner-dashboard-card",
                       _dashboard_config=lambda: {"default": True},
                       _LOGGER=SimpleNamespace(info=lambda *_args: None))
        data = {"views": [{"type": "panel", "cards": [{"type": "custom:week-planner-card"}]}]}
        saves = []
        async def load(_force):
            return data
        async def save(config):
            nonlocal data
            saves.append(config)
            data = config
        dashboard = SimpleNamespace(async_load=load, async_save=save)
        await ns["_async_load_native_dashboard"](dashboard)
        await ns["_async_load_native_dashboard"](dashboard)
        self.assertEqual(len(saves), 1)
        data = {"views": [{"panel": True, "cards": [{"type": "custom:week-planner-card"}]}]}
        async def fail(config):
            saves.append(config)
            raise RuntimeError("Storage unavailable")
        dashboard.async_save = fail
        with self.assertRaisesRegex(RuntimeError, "Storage unavailable"):
            await ns["_async_load_native_dashboard"](dashboard)
        self.assertEqual(len(saves), 2)
        self.assertNotIn("default", saves[-1])

    async def test_moon_rejects_inverted_and_oversized_ranges(self):
        async def executor(*_args):
            self.fail("Invalid range reached executor")
        ns = functions("websocket_get_moon_transitions",
                       dt_util=SimpleNamespace(get_default_time_zone=lambda: timezone.utc),
                       _moon_transitions=lambda *_args: [])
        hass = SimpleNamespace(async_add_executor_job=executor)
        for start, end in [("2026-11-02", "2026-11-01"),
                           ("2026-11-02", "2026-11-02"),
                           ("2026-11-02", "2026-12-05")]:
            connection = Connection()
            await ns["websocket_get_moon_transitions"](hass, connection,
                {"id": 1, "start": start, "end": end})
            self.assertEqual(connection.error[0], "invalid_range")

    async def test_moon_work_runs_through_executor(self):
        calls = []
        async def executor(fn, *args):
            calls.append(args)
            return fn(*args)
        ns = functions("websocket_get_moon_transitions",
                       dt_util=SimpleNamespace(get_default_time_zone=lambda: timezone.utc),
                       _moon_transitions=lambda *_args: [{"phase": "test"}])
        connection = Connection()
        await ns["websocket_get_moon_transitions"](
            SimpleNamespace(async_add_executor_job=executor), connection,
            {"id": 1, "start": "2026-11-02T00:00:00+01:00",
             "end": "2026-11-16T00:00:00+01:00"})
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0].tzinfo, timezone.utc)
        self.assertEqual(connection.result, [{"phase": "test"}])

    async def test_daylight_cache_is_invalidated_by_location_and_yields(self):
        calls = []
        def daylight(_hass, date):
            calls.append(date)
            return date.timetuple().tm_yday
        ns = functions("_year_daylight_extrema", DOMAIN="week_planner",
                       _daylight_minutes_for_date=daylight)
        hass = SimpleNamespace(data={}, config=SimpleNamespace(
            latitude=55, longitude=12, time_zone="Europe/Copenhagen"))
        task = asyncio.create_task(ns["_year_daylight_extrema"](hass, 2026))
        await asyncio.sleep(0)
        self.assertFalse(task.done(), "Whole year must not block the event loop")
        first = await task
        self.assertEqual(len(calls), 365)
        self.assertEqual(first["min_minutes"], 1)
        self.assertEqual(first["max_minutes"], 365)
        await ns["_year_daylight_extrema"](hass, 2026)
        self.assertEqual(len(calls), 365)
        hass.config.latitude = 56
        await ns["_year_daylight_extrema"](hass, 2026)
        self.assertEqual(len(calls), 730)

    async def test_reload_does_not_register_static_path_twice_and_hass_isolation(self):
        registrations = []
        async def register(paths):
            registrations.append(paths)
        async def noop(*_args):
            pass
        ns = functions("async_setup_entry", "async_unload_entry",
                       DOMAIN="week_planner", Path=Path, __file__=str(Path("custom_components/week_planner/__init__.py")),
                       STATIC_URL="/week_planner_static",
                       StaticPathConfig=lambda *args: args,
                       _async_ensure_lovelace_resource=noop,
                       _async_ensure_native_dashboard=noop,
                       async_remove_panel=lambda *_args: None, PANEL_URL="week-planner")
        entry = SimpleNamespace(entry_id="test", data={}, options={})
        first = SimpleNamespace(data={}, http=SimpleNamespace(async_register_static_paths=register))
        second = SimpleNamespace(data={}, http=SimpleNamespace(async_register_static_paths=register))
        await ns["async_setup_entry"](first, entry)
        await ns["async_unload_entry"](first, entry)
        await ns["async_setup_entry"](first, entry)
        self.assertEqual(len(registrations), 1)
        await ns["async_setup_entry"](second, entry)
        self.assertEqual(len(registrations), 2)

    async def test_update_endpoint_requires_admin_before_scheduling_write(self):
        node = next(node for node in TREE.body
                    if isinstance(node, ast.AsyncFunctionDef) and node.name == "websocket_update_config")
        decorators = [ast.unparse(item) for item in node.decorator_list]
        self.assertLess(decorators.index("websocket_api.require_admin"),
                        decorators.index("websocket_api.async_response"))

if __name__ == "__main__":
    unittest.main()
