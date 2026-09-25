import { t } from "@lingui/core/macro"
import { Plural, Trans } from "@lingui/react/macro"
import { useLingui } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	type Table as TableType,
	useReactTable,
} from "@tanstack/react-table"
import { type VirtualItem, useVirtualizer } from "@tanstack/react-virtual"
import {
	ActivityIcon,
	ArrowLeftRightIcon,
	ClockIcon,
	GlobeIcon,
	LoaderCircleIcon,
	ShieldCheckIcon,
	TimerIcon,
} from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { NetworkMonitorSheet } from "@/components/network-monitors-table/network-monitors-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { getPbTimestamp, pb } from "@/lib/api"
import { getCertDaysLeft, getCertExpiryLevel, getMonitorLabel, getMonitorTarget } from "@/lib/network-monitor-utils"
import { $allSystemsById } from "@/lib/stores"
import {
	buildAvailabilitySegments,
	countIncidents,
	groupMonitorStats,
	summarizeUptime,
	type AvailabilitySegment,
	type UptimePeriod,
	type UptimeSummary,
} from "@/lib/uptime"
import { cn, decimalString, formatMicroseconds, formatShortDate, hourWithSeconds, useBrowserStorage } from "@/lib/utils"
import type { ChartTimes, NetworkMonitorRecord, RawMonitorStatsRecord } from "@/types"

const periodConfig: Record<
	UptimePeriod,
	{ chartTime: ChartTimes; type: string; segmentCount: number; segmentDuration: number; expectedInterval: number }
> = {
	"24h": {
		chartTime: "24h",
		type: "20m",
		segmentCount: 24,
		segmentDuration: 60 * 60 * 1000,
		expectedInterval: 20 * 60 * 1000,
	},
	"7d": {
		chartTime: "1w",
		type: "120m",
		segmentCount: 28,
		segmentDuration: 6 * 60 * 60 * 1000,
		expectedInterval: 2 * 60 * 60 * 1000,
	},
	"30d": {
		chartTime: "30d",
		type: "480m",
		segmentCount: 30,
		segmentDuration: 24 * 60 * 60 * 1000,
		expectedInterval: 8 * 60 * 60 * 1000,
	},
}

const protocolColors: Record<string, string> = {
	icmp: "bg-blue-500/15! text-blue-600 dark:text-blue-400",
	tcp: "bg-purple-500/15! text-purple-600 dark:text-purple-400",
	http: "bg-green-500/15! text-green-700 dark:text-green-400",
	dns: "bg-amber-500/15! text-amber-600 dark:text-amber-400",
}

type UptimeStatus = "up" | "degraded" | "down" | "paused" | "unknown"

interface UptimeRow {
	monitor: NetworkMonitorRecord
	name: string
	target: string
	systemName: string
	status: UptimeStatus
	statusLabel: string
	uptime: UptimeSummary | undefined
	history: AvailabilitySegment[]
	incidents: number
	certDays: number | null
}

interface UptimeHistoryState {
	records: RawMonitorStatsRecord[]
	fetchedAt: number
}

const emptyHistory: UptimeHistoryState = {
	records: [],
	fetchedAt: Date.now(),
}

function getUptimeStatus(monitor: NetworkMonitorRecord, systemStatus?: string): UptimeStatus {
	if (!monitor.enabled || systemStatus === "paused") return "paused"
	if (systemStatus !== "up" || !monitor.updated) return "unknown"
	if (!monitor.res) return "down"
	if (monitor.loss1h > 0) return "degraded"
	return "up"
}

function formatUptime(value: number | null | undefined) {
	if (value === null || value === undefined) return "-"
	if (value >= 99.995) return "100%"
	return `${decimalString(value, value >= 99 ? 3 : 2)}%`
}

function useUptimeHistory(period: UptimePeriod, enabled: boolean) {
	const [history, setHistory] = useState<UptimeHistoryState>(emptyHistory)
	const [isLoading, setIsLoading] = useState(false)

	useEffect(() => {
		if (!enabled) return
		let disposed = false
		const config = periodConfig[period]
		setHistory({ records: [], fetchedAt: Date.now() })

		async function fetchHistory() {
			if (!disposed) setIsLoading(true)
			try {
				const records = await pb.collection<RawMonitorStatsRecord>("network_monitor_stats").getFullList({
					filter: pb.filter("created>{:created} && type={:type}", {
						created: getPbTimestamp(config.chartTime, undefined, true),
						type: config.type,
					}),
					fields: "monitor,res_min,res_max,total_count,success_count,res_sum,created",
					sort: "created",
					requestKey: `uptime:${period}`,
				})
				if (!disposed) {
					setHistory({ records, fetchedAt: Date.now() })
				}
			} catch (error) {
				if (!disposed) {
					toast({ title: t`Error`, description: (error as Error)?.message, variant: "destructive" })
				}
			} finally {
				if (!disposed) setIsLoading(false)
			}
		}

		fetchHistory()
		const interval = window.setInterval(fetchHistory, 5 * 60 * 1000)
		return () => {
			disposed = true
			window.clearInterval(interval)
			pb.cancelRequest(`uptime:${period}`)
		}
	}, [enabled, period])

	return { history, isLoading }
}

export default function UptimeTable({ monitors, isLoading }: { monitors: NetworkMonitorRecord[]; isLoading: boolean }) {
	const { t } = useLingui()
	const systems = useStore($allSystemsById)
	const [period, setPeriod] = useBrowserStorage<UptimePeriod>("uptime-period", "24h", sessionStorage)
	const { history, isLoading: historyLoading } = useUptimeHistory(period, monitors.length > 0)
	const [sorting, setSorting] = useBrowserStorage<SortingState>(
		"sort-uptime-2",
		[{ id: "status", desc: false }],
		sessionStorage
	)
	const [globalFilter, setGlobalFilter] = useState("")
	const [statusFilter, setStatusFilter] = useState("all")
	const [protocolFilter, setProtocolFilter] = useState("all")
	const [activeMonitor, setActiveMonitor] = useState<NetworkMonitorRecord>()

	const periodLabels: Record<UptimePeriod, string> = {
		"24h": t`1 day`,
		"7d": t`7 days`,
		"30d": t`30 days`,
	}
	const historyLabels: Record<UptimePeriod, string> = {
		"24h": t`Last 1 day`,
		"7d": t`Last 7 days`,
		"30d": t`Last 30 days`,
	}
	const selectedPeriod = periodConfig[period]
	const summaries = useMemo(() => summarizeUptime(history.records), [history.records])
	const historyByMonitor = useMemo(() => groupMonitorStats(history.records), [history.records])

	const data = useMemo<UptimeRow[]>(() => {
		return monitors.map((monitor) => {
			const system = systems[monitor.system]
			const status = getUptimeStatus(monitor, system?.status)
			const statusLabels: Record<UptimeStatus, string> = {
				up: t`Up`,
				degraded: t`Degraded`,
				down: t`Down`,
				paused: t`Paused`,
				unknown: t`Unknown`,
			}
			const monitorHistory = historyByMonitor.get(monitor.id) ?? []
			return {
				monitor,
				name: getMonitorLabel(monitor),
				target: getMonitorTarget(monitor),
				systemName: system?.name ?? "",
				status,
				statusLabel: statusLabels[status],
				uptime: summaries.get(monitor.id),
				history: buildAvailabilitySegments(
					monitorHistory,
					history.fetchedAt,
					selectedPeriod.segmentCount,
					selectedPeriod.segmentDuration
				),
				incidents: countIncidents(monitorHistory, selectedPeriod.expectedInterval),
				certDays: monitor.certInfo?.expires ? getCertDaysLeft(monitor.certInfo, history.fetchedAt) : null,
			}
		})
	}, [history.fetchedAt, historyByMonitor, monitors, selectedPeriod, summaries, systems, t])

	const filteredData = useMemo(
		() =>
			data.filter(
				(row) =>
					(statusFilter === "all" || row.status === statusFilter) &&
					(protocolFilter === "all" || row.monitor.protocol === protocolFilter)
			),
		[data, protocolFilter, statusFilter]
	)

	const statusTotals = useMemo(() => {
		const totals: Record<UptimeStatus, number> = { up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }
		for (const row of data) totals[row.status]++
		return totals
	}, [data])

	const columns = useMemo<ColumnDef<UptimeRow>[]>(
		() => [
			{
				id: "status",
				header: ({ column }) => <HeaderButton column={column} name={t`Status`} Icon={ActivityIcon} />,
				accessorFn: (row) => row.status,
				cell: ({ row }) => <StatusCell row={row.original} />,
				size: 112,
			},
			{
				id: "target",
				header: ({ column }) => <HeaderButton column={column} name={t`Monitor`} Icon={GlobeIcon} />,
				accessorFn: (row) => `${row.name} ${row.target} ${row.systemName}`,
				cell: ({ row }) => (
					<div className="ms-1.5 min-w-48 max-w-80">
						<div className="truncate font-medium">{row.original.name}</div>
						<div className="truncate text-xs text-muted-foreground">
							{row.original.monitor.name?.trim()
								? `${row.original.target} · ${row.original.systemName}`
								: row.original.systemName}
						</div>
					</div>
				),
				sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
				size: 300,
			},
			{
				id: "protocol",
				header: ({ column }) => <HeaderButton column={column} name={t`Protocol`} Icon={ArrowLeftRightIcon} />,
				accessorFn: (row) => row.monitor.protocol,
				cell: ({ row }) => (
					<Badge className={cn("uppercase ms-1.5", protocolColors[row.original.monitor.protocol])}>
						{row.original.monitor.protocol}
					</Badge>
				),
				size: 105,
			},
			{
				id: "response",
				header: ({ column }) => <HeaderButton column={column} name={t`Response`} Icon={TimerIcon} />,
				accessorFn: (row) => row.monitor.res || undefined,
				cell: ({ row }) => (
					<span className="ms-1.5 tabular-nums">
						{row.original.monitor.res ? formatMicroseconds(row.original.monitor.res) : "-"}
					</span>
				),
				invertSorting: true,
				size: 115,
			},
			{
				id: "uptime",
				header: ({ column }) => (
					<HeaderButton column={column} name={`${t`Uptime`} ${periodLabels[period]}`} Icon={ActivityIcon} />
				),
				accessorFn: (row) => row.uptime?.uptime,
				cell: ({ row }) => <UptimeCell summary={row.original.uptime} muted={row.original.status === "paused"} />,
				invertSorting: true,
				size: 135,
			},
			{
				id: "history",
				header: () => (
					<div className="h-9 px-3 flex items-center gap-2 font-medium">
						<ActivityIcon className="size-4" />
						{historyLabels[period]}
					</div>
				),
				cell: ({ row }) => (
					<AvailabilityHistory
						history={row.original.history}
						incidents={row.original.incidents}
						label={historyLabels[period]}
					/>
				),
				enableSorting: false,
				size: 230,
			},
			{
				id: "certificate",
				header: ({ column }) => <HeaderButton column={column} name={t`Certificate`} Icon={ShieldCheckIcon} />,
				accessorFn: (row) => row.certDays ?? undefined,
				cell: ({ row }) => <CertificateCell days={row.original.certDays} muted={row.original.status === "paused"} />,
				size: 130,
			},
			{
				id: "updated",
				header: ({ column }) => <HeaderButton column={column} name={t`Last check`} Icon={ClockIcon} />,
				accessorFn: (row) => row.monitor.updated,
				cell: ({ row }) => <LastCheck value={row.original.monitor.updated} />,
				invertSorting: true,
				size: 120,
			},
		],
		[historyLabels, period, periodLabels, t]
	)

	const table = useReactTable({
		data: filteredData,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		state: { sorting, globalFilter },
		globalFilterFn: (row, _columnId, filterValue) => {
			const item = row.original
			const search =
				`${item.name} ${item.target} ${item.systemName} ${item.monitor.protocol} ${item.statusLabel}`.toLowerCase()
			return (filterValue as string)
				.toLowerCase()
				.split(" ")
				.every((term) => search.includes(term))
		},
		defaultColumn: { sortUndefined: "last", size: 100, minSize: 0 },
	})

	const rows = table.getRowModel().rows
	const openMonitor = useCallback((monitor: NetworkMonitorRecord) => setActiveMonitor(monitor), [])

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid gap-3 xl:flex xl:items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Uptime</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {data.length}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Operational: {statusTotals.up + statusTotals.degraded}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Down: {statusTotals.down}</Trans>
							{statusTotals.paused > 0 && (
								<>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<Trans>Paused: {statusTotals.paused}</Trans>
								</>
							)}
							{historyLoading && (
								<>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<span className="flex items-center gap-1.5">
										<LoaderCircleIcon className="size-3 animate-spin" />
										<Trans>Loading history...</Trans>
									</span>
								</>
							)}
						</div>
					</div>
					<div className="grid gap-2 sm:flex xl:ms-auto">
						<Input
							placeholder={t`Filter...`}
							value={globalFilter}
							onChange={(event) => setGlobalFilter(event.target.value)}
							className="px-4 w-full sm:w-60"
						/>
						<div className="grid grid-cols-2 gap-2 sm:flex">
							<Select value={period} onValueChange={(value) => setPeriod(value as UptimePeriod)}>
								<SelectTrigger className="col-span-2 w-full sm:w-32" aria-label={t`Period`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="24h">
										<Trans>1 day</Trans>
									</SelectItem>
									<SelectItem value="7d">
										<Trans>7 days</Trans>
									</SelectItem>
									<SelectItem value="30d">
										<Trans>30 days</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
							<Select value={statusFilter} onValueChange={setStatusFilter}>
								<SelectTrigger className="w-full sm:w-36" aria-label={t`Status`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">
										<Trans>All statuses</Trans>
									</SelectItem>
									<SelectItem value="up">
										<Trans>Up</Trans>
									</SelectItem>
									<SelectItem value="degraded">
										<Trans>Degraded</Trans>
									</SelectItem>
									<SelectItem value="down">
										<Trans>Down</Trans>
									</SelectItem>
									<SelectItem value="paused">
										<Trans>Paused</Trans>
									</SelectItem>
									<SelectItem value="unknown">
										<Trans>Unknown</Trans>
									</SelectItem>
								</SelectContent>
							</Select>
							<Select value={protocolFilter} onValueChange={setProtocolFilter}>
								<SelectTrigger className="w-full sm:w-32" aria-label={t`Protocol`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">
										<Trans>All protocols</Trans>
									</SelectItem>
									<SelectItem value="http">HTTP</SelectItem>
									<SelectItem value="tcp">TCP</SelectItem>
									<SelectItem value="icmp">ICMP</SelectItem>
									<SelectItem value="dns">DNS</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			</CardHeader>
			<UptimeDataTable table={table} rows={rows} loading={isLoading} onOpenMonitor={openMonitor} />
			<NetworkMonitorSheet
				open={!!activeMonitor}
				onOpenChange={(open) => {
					if (!open) setActiveMonitor(undefined)
				}}
				monitor={activeMonitor}
			/>
		</Card>
	)
}

const UptimeDataTable = memo(function UptimeDataTable({
	table,
	rows,
	loading,
	onOpenMonitor,
}: {
	table: TableType<UptimeRow>
	rows: Row<UptimeRow>[]
	loading: boolean
	onOpenMonitor: (monitor: NetworkMonitorRecord) => void
}) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
		count: rows.length,
		estimateSize: () => 58,
		getScrollElement: () => scrollRef.current,
		overscan: 5,
	})
	const virtualRows = virtualizer.getVirtualItems()
	const paddingTop = Math.max(0, (virtualRows[0]?.start ?? 0) - virtualizer.options.scrollMargin)
	const paddingBottom = Math.max(0, virtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0))

	return (
		<div
			className={cn(
				"h-min max-h-[calc(100dvh-17rem)] max-w-full relative overflow-auto border rounded-md",
				(!rows.length || rows.length > 2) && "min-h-50"
			)}
			ref={scrollRef}
		>
			<div style={{ height: `${virtualizer.getTotalSize() + 48}px`, paddingTop, paddingBottom }}>
				<table className="text-sm w-full h-full text-nowrap">
					<TableHeader className="sticky top-0 z-50 w-full border-b-2">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead className="px-2" key={header.id} style={{ width: header.getSize() }}>
										{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
									</TableHead>
								))}
							</tr>
						))}
					</TableHeader>
					<TableBody>
						{rows.length ? (
							virtualRows.map((virtualRow) => {
								const row = rows[virtualRow.index]
								return <UptimeTableRow key={row.id} row={row} virtualRow={virtualRow} onOpenMonitor={onOpenMonitor} />
							})
						) : (
							<TableRow>
								<TableCell
									colSpan={table.getVisibleLeafColumns().length}
									className="h-37 text-center pointer-events-none"
								>
									{loading ? <Trans>Loading...</Trans> : <Trans>No results.</Trans>}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>
		</div>
	)
})

const UptimeTableRow = memo(function UptimeTableRow({
	row,
	virtualRow,
	onOpenMonitor,
}: {
	row: Row<UptimeRow>
	virtualRow: VirtualItem
	onOpenMonitor: (monitor: NetworkMonitorRecord) => void
}) {
	const open = () => onOpenMonitor(row.original.monitor)
	return (
		<TableRow
			className="cursor-pointer"
			tabIndex={0}
			aria-label={`${row.original.name}, ${row.original.statusLabel}`}
			onClick={open}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault()
					open()
				}
			}}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell key={cell.id} className="py-0" style={{ height: virtualRow.size }}>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	)
})

const statusColors: Record<UptimeStatus, string> = {
	up: "bg-green-500",
	degraded: "bg-yellow-500",
	down: "bg-red-500",
	paused: "bg-muted-foreground/50",
	unknown: "bg-primary/40",
}

function StatusCell({ row }: { row: UptimeRow }) {
	return (
		<span className="ms-1.5 flex items-center gap-2">
			<span className={cn("size-2 shrink-0 rounded-full", statusColors[row.status])} />
			{row.statusLabel}
		</span>
	)
}

function UptimeCell({ summary, muted }: { summary?: UptimeSummary; muted: boolean }) {
	const uptime = summary?.uptime
	let color = "bg-green-500"
	if (muted || uptime === null || uptime === undefined) color = "bg-muted-foreground/50"
	else if (uptime < 99) color = "bg-red-500"
	else if (uptime < 99.9) color = "bg-yellow-500"
	return (
		<span className="ms-1.5 tabular-nums flex items-center gap-2">
			<span className={cn("size-2 shrink-0 rounded-full", color)} />
			{formatUptime(uptime)}
		</span>
	)
}

function AvailabilityHistory({
	history,
	incidents,
	label,
}: {
	history: AvailabilitySegment[]
	incidents: number
	label: string
}) {
	const observed = history.filter((segment) => segment.total > 0).length
	return (
		<div className="ms-1.5 min-w-48" role="img" aria-label={`${t`Availability history`}: ${label}`}>
			<div className="flex h-5 items-stretch gap-0.5" aria-hidden="true">
				{history.map((segment, index) => {
					let color = "bg-muted-foreground/20"
					if (segment.uptime !== null) {
						if (segment.uptime >= 100) color = "bg-green-500"
						else if (segment.uptime > 0) color = "bg-yellow-500"
						else color = "bg-red-500"
					}
					return <span key={index} className={cn("min-w-1 flex-1 rounded-[2px]", color)} />
				})}
			</div>
			<div className="mt-1 text-xs text-muted-foreground">
				{observed === 0 ? (
					<Trans>No history</Trans>
				) : incidents === 0 ? (
					<Trans>No incidents</Trans>
				) : (
					<Plural value={incidents} one="# incident" other="# incidents" />
				)}
			</div>
		</div>
	)
}

function CertificateCell({ days, muted }: { days: number | null; muted: boolean }) {
	if (days === null) return <span className="ms-1.5 text-muted-foreground">-</span>
	const colors = { ok: "bg-green-500", warning: "bg-yellow-500", critical: "bg-red-500" }
	const color = muted ? "bg-muted-foreground/50" : colors[getCertExpiryLevel(days)]
	return (
		<span className="ms-1.5 flex items-center gap-2 tabular-nums">
			<span className={cn("size-2 shrink-0 rounded-full", color)} />
			{days < 0 ? <Trans>Expired</Trans> : <Plural value={days} one="# day" other="# days" />}
		</span>
	)
}

function LastCheck({ value }: { value: string }) {
	if (!value) return <span className="ms-1.5 text-muted-foreground">-</span>
	const date = new Date(value)
	const formatter = date.toDateString() === new Date().toDateString() ? hourWithSeconds : formatShortDate
	return (
		<span className="ms-1.5 tabular-nums" title={date.toLocaleString()}>
			{formatter(value)}
		</span>
	)
}

function HeaderButton({
	column,
	name,
	Icon,
}: {
	column: { getIsSorted: () => false | "asc" | "desc"; toggleSorting: (desc: boolean) => void }
	name: string
	Icon: React.ElementType
}) {
	const isSorted = column.getIsSorted()
	return (
		<Button
			className={cn(
				"h-9 px-3 flex items-center gap-2 duration-50",
				isSorted && "bg-accent/70 light:bg-accent text-accent-foreground/90"
			)}
			variant="ghost"
			onClick={() => column.toggleSorting(isSorted === "asc")}
		>
			<Icon className="size-4" />
			{name}
		</Button>
	)
}
