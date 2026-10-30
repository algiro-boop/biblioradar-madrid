"""Synthetic examples validate morning and afternoon forecasts, never library capacities."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pglast import parse_sql

from biblioradar.report_memory import forecast_memory, memory_pct
from biblioradar.report_priority import CommunityReport

START = datetime(2027, 7, 15, 10, tzinfo=UTC)


def report(value=90, minutes=0, device="a"):
    return CommunityReport(device, value, START + timedelta(minutes=minutes), device)


@pytest.mark.parametrize("hour", [10, 15])
def test_curve_rising_keeps_occupancy_high_in_both_periods(hour):
    at = START.replace(hour=hour)
    result = forecast_memory(
        70, [CommunityReport("a", 90, at)], at + timedelta(hours=2), at, lambda _: 50
    )
    assert result.pct == 90
    assert result.reported_at == at
    assert result.report_count == 1


def test_full_afternoon_forecast_then_falling_curve():
    assert memory_pct(70, 50, 50, 7200) == 95
    assert memory_pct(40, 50, 50, 18000) < 70
    assert memory_pct(20, 50, 50, 18000) < memory_pct(40, 50, 50, 18000)


def test_new_low_cohort_replaces_high_morning_observation():
    reports = [report(100), report(40, 120, "b")]
    result = forecast_memory(
        70, reports, START + timedelta(hours=2), START, lambda at: 50 if at == START else 70
    )
    assert result.pct == 40 and result.report_count == 1
    assert result.reported_at == START + timedelta(hours=2)


def test_duplicate_device_cannot_amplify_older_evidence():
    reports = [report(100), report(40, 5), report(20, 6)]
    result = forecast_memory(50, reports, START + timedelta(minutes=6), START, lambda _: 50)
    assert result.report_count == 1 and result.pct == 20


def test_session_boundary_and_closed_do_not_carry_memory():
    assert (
        forecast_memory(
            70, [report()], START + timedelta(hours=2), START + timedelta(hours=1), lambda _: 50
        )
        is None
    )
    assert forecast_memory(70, [report()], START, START, lambda _: 50, is_open=False) is None


def test_future_and_expired_reports_and_smooth_taper():
    assert forecast_memory(70, [report(100, 1)], START, START, lambda _: 50) is None
    assert forecast_memory(70, [report()], START + timedelta(hours=6), START, lambda _: 50) is None
    assert memory_pct(50, 50, 50, 21599) == 50
    assert memory_pct(50, 50, 50, 21600) is None
    assert memory_pct(50, 50, 50, -1) is None


def test_repeating_forecast_never_uses_previous_output_as_input():
    a = forecast_memory(70, [report()], START + timedelta(hours=2), START, lambda _: 50)
    b = forecast_memory(70, [report()], START + timedelta(hours=2), START, lambda _: 50)
    assert a == b and a.pct == 90


def test_low_observation_also_follows_the_curve():
    assert memory_pct(70, 50, -30, 7200) == 55
    assert memory_pct(70, 50, 0, 7200) == 70
    assert memory_pct(100, 50, 100, 0) == 100
    assert memory_pct(0, 50, -100, 0) == 0


def test_sql_parse():
    root = Path(__file__).resolve().parents[1]
    for file in [
        "supabase/migrations/202610300012_report_memory.sql",
        "tests/report_memory_smoke.sql",
    ]:
        assert parse_sql((root / file).read_text())
