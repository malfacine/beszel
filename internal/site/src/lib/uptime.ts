import type { RawMonitorStatsRecord } from "@/types"

export type UptimePeriod = "24h" | "7d" | "30d"

export interface UptimeSummary {
	uptime: number | null
	response: number | null
	total: number
	success: number
}

export interface AvailabilitySegment {
	uptime: number | null
	total: number
}

export function summarizeUptime(records: RawMonitorStatsRecord[]) {
	const totals = new Map<string, { total: number; success: number; responseSum: number }>()
	for (const record of records) {
		const current = totals.get(record.monitor) ?? { total: 0, success: 0, responseSum: 0 }
		current.total += record.total_count
		current.success += record.success_count
		current.responseSum += record.res_sum
		totals.set(record.monitor, current)
	}

	const summaries = new Map<string, UptimeSummary>()
	for (const [monitor, total] of totals) {
		summaries.set(monitor, {
			uptime: total.total > 0 ? (total.success / total.total) * 100 : null,
			response: total.success > 0 ? total.responseSum / total.success : null,
			total: total.total,
			success: total.success,
		})
	}
	return summaries
}

export function groupMonitorStats(records: RawMonitorStatsRecord[]) {
	const grouped = new Map<string, RawMonitorStatsRecord[]>()
	for (const record of records) {
		const monitorRecords = grouped.get(record.monitor)
		if (monitorRecords) {
			monitorRecords.push(record)
		} else {
			grouped.set(record.monitor, [record])
		}
	}
	for (const monitorRecords of grouped.values()) {
		monitorRecords.sort((a, b) => a.created - b.created)
	}
	return grouped
}

export function buildAvailabilitySegments(
	records: RawMonitorStatsRecord[],
	endTime = Date.now(),
	segmentCount = 24,
	segmentDuration = 60 * 60 * 1000
): AvailabilitySegment[] {
	const startTime = endTime - segmentCount * segmentDuration
	const segments = Array.from({ length: segmentCount }, () => ({ total: 0, success: 0 }))

	for (const record of records) {
		const index = Math.floor((record.created - startTime) / segmentDuration)
		if (index < 0 || index >= segmentCount) continue
		segments[index].total += record.total_count
		segments[index].success += record.success_count
	}

	return segments.map(({ total, success }) => ({
		total,
		uptime: total > 0 ? (success / total) * 100 : null,
	}))
}

export function countIncidents(records: RawMonitorStatsRecord[], expectedInterval = 20 * 60 * 1000) {
	let incidents = 0
	let inIncident = false
	let previousCreated = 0

	for (const record of records) {
		const hasFailure = record.total_count > record.success_count
		const hasGap = previousCreated > 0 && record.created - previousCreated > expectedInterval * 1.5
		if (hasFailure && (!inIncident || hasGap)) {
			incidents++
		}
		inIncident = hasFailure
		previousCreated = record.created
	}

	return incidents
}
