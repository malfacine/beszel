import { describe, expect, test } from "bun:test"
import { buildAvailabilitySegments, countIncidents, groupMonitorStats, summarizeUptime } from "../src/lib/uptime"
import type { RawMonitorStatsRecord } from "../src/types"

const record = (
	monitor: string,
	created: number,
	total: number,
	success: number,
	responseSum = success * 1_000
): RawMonitorStatsRecord => ({
	monitor,
	created,
	total_count: total,
	success_count: success,
	res_sum: responseSum,
	res_min: success ? 500 : 0,
	res_max: success ? 1_500 : 0,
})

describe("uptime summaries", () => {
	test("weights availability and response by probe counts", () => {
		const summaries = summarizeUptime([record("a", 1, 10, 9, 9_000), record("a", 2, 2, 1, 3_000)])
		expect(summaries.get("a")).toEqual({
			uptime: (10 / 12) * 100,
			response: 1_200,
			total: 12,
			success: 10,
		})
	})

	test("keeps monitors independent", () => {
		const grouped = groupMonitorStats([record("b", 3, 1, 1), record("a", 2, 1, 0), record("a", 1, 1, 1)])
		expect(grouped.get("a")?.map(({ created }) => created)).toEqual([1, 2])
		expect(grouped.get("b")?.length).toBe(1)
	})
})

describe("uptime history", () => {
	test("builds fixed hourly segments and preserves missing data", () => {
		const hour = 60 * 60 * 1000
		const end = 4 * hour
		const segments = buildAvailabilitySegments(
			[record("a", hour + 1, 3, 3), record("a", 2 * hour + 1, 4, 2)],
			end,
			4,
			hour
		)
		expect(segments.map(({ uptime }) => uptime)).toEqual([null, 100, 50, null])
	})

	test("uses the selected period granularity for longer histories", () => {
		const sixHours = 6 * 60 * 60 * 1000
		const end = 28 * sixHours
		const segments = buildAvailabilitySegments(
			[record("a", 7 * sixHours + 1, 2, 2), record("a", 27 * sixHours + 1, 2, 1)],
			end,
			28,
			sixHours
		)
		expect(segments).toHaveLength(28)
		expect(segments[7].uptime).toBe(100)
		expect(segments[27].uptime).toBe(50)
	})

	test("counts contiguous failures as one incident and splits gaps", () => {
		const interval = 20 * 60 * 1000
		const records = [
			record("a", 0, 1, 1),
			record("a", interval, 1, 0),
			record("a", interval * 2, 1, 0),
			record("a", interval * 3, 1, 1),
			record("a", interval * 4, 1, 0),
			record("a", interval * 7, 1, 0),
		]
		expect(countIncidents(records, interval)).toBe(3)
	})
})
