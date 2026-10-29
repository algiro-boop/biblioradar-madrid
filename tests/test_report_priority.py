from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pglast import parse_sql

from biblioradar.report_priority import CommunityReport, display_pct, fuse_reports

NOW = datetime(2027, 7, 15, 10, tzinfo=UTC)


def report(value, age=0, device="a", id="a"):
    return CommunityReport(device, value, NOW - timedelta(minutes=age), id)


def test_general_report_has_doubled_weight():
    r = fuse_reports(40, 20, [report(75)], NOW)
    assert r.bayesian_pct == 63  # (40*20 + 75*40)/60
    assert r.displayed_pct == 63
    assert r.confidence == pytest.approx(40 / 60)


@pytest.mark.parametrize(
    "minutes,expected", [(0, 100), (10, 100), (12.5, 90), (15, 80), (16, 80), (-1, 80)]
)
def test_hold_fade_expiry_and_future(minutes, expected):
    assert display_pct(80, NOW - timedelta(minutes=minutes), NOW) == expected


def test_immediate_full_and_continuing_decay_are_separate_from_posterior():
    r = fuse_reports(40, 20, [report(100)], NOW)
    assert r.bayesian_pct == 80
    assert r.displayed_pct == 100
    assert r.full_reported_at == NOW
    aged = fuse_reports(40, 20, [report(100, 40)], NOW)
    assert aged.bayesian_pct == 70
    assert aged.displayed_pct == 70


def test_old_and_future_reports_do_not_vote():
    r = fuse_reports(40, 20, [report(100, 91), report(100, -1)], NOW)
    assert r.displayed_pct == 40 and r.active_reports_count == 0
    assert r.full_reported_at is None


def test_new_availability_cancels_single_full_report():
    r = fuse_reports(40, 20, [report(100, 5), report(40, 1, "b")], NOW)
    assert r.full_reported_at is None
    assert r.displayed_pct == r.bayesian_pct < 100


def test_new_full_is_immediate_even_after_multiple_old_contrary_votes():
    r = fuse_reports(40, 20, [report(40, 1, "b"), report(40, 2, "c"), report(100)], NOW)
    assert r.displayed_pct == 100


def test_consensus_requires_enough_newer_distinct_votes_to_cancel():
    full = [report(100, 5, "a"), report(100, 4, "b")]
    assert fuse_reports(40, 20, full + [report(40, 2, "c")], NOW).displayed_pct == 100
    r = fuse_reports(40, 20, full + [report(40, 2, "c"), report(20, 1, "d")], NOW)
    assert r.full_reported_at is None


def test_same_device_only_latest_vote_and_equal_timestamp_tie_break():
    r = fuse_reports(40, 20, [report(100, 5), report(40, 1)], NOW)
    assert r.active_reports_count == 1 and r.full_reported_at is None
    r = fuse_reports(40, 20, [report(100, 0, "a", "1"), report(40, 0, "b", "2")], NOW)
    assert r.full_reported_at is None


def test_closed_wins_and_no_report_count_is_fabricated():
    r = fuse_reports(40, 20, [report(100)], NOW, is_open=False)
    assert r.displayed_pct == 0 and r.full_reported_at is None
    r = fuse_reports(40, 20, [], NOW)
    assert r.displayed_pct == 40 and r.confidence == 0


def test_migration_and_smoke_parse():
    root = Path(__file__).resolve().parents[1]
    for name in [
        "supabase/migrations/202610290011_report_priority.sql",
        "tests/report_priority_smoke.sql",
    ]:
        assert parse_sql((root / name).read_text())
