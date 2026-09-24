import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import {
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
import { LoaderCircleIcon } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { getProcessStatusLabel, processTableColumns } from "@/components/processes-table/processes-table-columns"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { $allSystemsById } from "@/lib/stores"
import { cn, useBrowserStorage } from "@/lib/utils"
import type { ProcessRecord, ProcessSnapshot } from "@/types"
import { Separator } from "../ui/separator"

const refreshInterval = 10_000

export default function ProcessesTable() {
	const [data, setData] = useState<ProcessRecord[] | undefined>(undefined)
	const [total, setTotal] = useState(0)
	const [unavailable, setUnavailable] = useState(0)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [sorting, setSorting] = useBrowserStorage<SortingState>("sort-p", [{ id: "cpu", desc: true }], sessionStorage)
	const [globalFilter, setGlobalFilter] = useState("")

	useEffect(() => {
		let disposed = false
		let inFlight = false

		async function fetchProcesses() {
			if (inFlight) return
			inFlight = true
			if (!disposed) setIsRefreshing(true)

			const systems = Object.values($allSystemsById.get()).filter((system) => system.status === "up")
			if (!systems.length) {
				if (!disposed) {
					setData([])
					setTotal(0)
					setUnavailable(0)
					setIsRefreshing(false)
				}
				inFlight = false
				return
			}

			const results = await Promise.allSettled(
				systems.map(async (system) => {
					const snapshot = await pb.send<ProcessSnapshot>("/api/beszel/processes", {
						system: system.id,
						requestKey: `processes:${system.id}`,
					})
					return { system: system.id, snapshot }
				})
			)

			if (!disposed) {
				const nextData: ProcessRecord[] = []
				let nextTotal = 0
				let failed = 0
				for (const result of results) {
					if (result.status === "rejected") {
						failed++
						continue
					}
					nextTotal += result.value.snapshot.total
					for (const process of result.value.snapshot.processes) {
						nextData.push({
							...process,
							system: result.value.system,
							updated: result.value.snapshot.updated,
						})
					}
				}
				setData(nextData)
				setTotal(nextTotal)
				setUnavailable(failed)
				setIsRefreshing(false)
			}
			inFlight = false
		}

		const unlisten = $allSystemsById.listen(() => {
			fetchProcesses()
		})
		const warmupTimer = window.setTimeout(() => {
			fetchProcesses()
		}, 1_500)
		const interval = window.setInterval(() => {
			fetchProcesses()
		}, refreshInterval)
		return () => {
			disposed = true
			unlisten()
			window.clearTimeout(warmupTimer)
			window.clearInterval(interval)
		}
	}, [])

	const table = useReactTable({
		data: data ?? [],
		columns: processTableColumns,
		getRowId: (row) => `${row.system}:${row.pid}:${row.started ?? 0}`,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		state: { sorting, globalFilter },
		onGlobalFilterChange: setGlobalFilter,
		globalFilterFn: (row, _columnId, filterValue) => {
			const process = row.original
			const systemName = $allSystemsById.get()[process.system]?.name ?? ""
			const searchString =
				`${systemName} ${process.name} ${process.pid} ${process.user ?? ""} ${getProcessStatusLabel(process.status)}`.toLowerCase()
			return (filterValue as string)
				.toLowerCase()
				.split(" ")
				.every((term) => searchString.includes(term))
		},
		defaultColumn: { sortUndefined: "last", size: 100, minSize: 0 },
	})

	const rows = table.getRowModel().rows
	const visibleColumns = table.getVisibleLeafColumns()
	const shown = data?.length ?? 0
	const running = useMemo(() => data?.filter((process) => process.status === "running").length ?? 0, [data])

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Processes</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							{data === undefined ? (
								<span className="flex items-center gap-2">
									<LoaderCircleIcon className="size-3.5 animate-spin" />
									<Trans>Loading...</Trans>
								</span>
							) : total > shown ? (
								<Trans>
									Showing {shown} of {total}
								</Trans>
							) : (
								<Trans>Total: {total}</Trans>
							)}
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Running: {running}</Trans>
							{unavailable > 0 && (
								<>
									<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
									<Trans>Unavailable systems: {unavailable}</Trans>
								</>
							)}
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<span className="flex items-center gap-1.5">
								{isRefreshing && data !== undefined && <LoaderCircleIcon className="size-3 animate-spin" />}
								<Trans>Updated every 10 seconds.</Trans>
							</span>
						</div>
					</div>
					<Input
						placeholder={t`Filter...`}
						value={globalFilter}
						onChange={(event) => setGlobalFilter(event.target.value)}
						className="ms-auto px-4 w-full max-w-full md:w-64"
					/>
				</div>
			</CardHeader>
			<div className="rounded-md">
				<ProcessTable table={table} rows={rows} colLength={visibleColumns.length} loading={data === undefined} />
			</div>
		</Card>
	)
}

const ProcessTable = memo(function ProcessTable({
	table,
	rows,
	colLength,
	loading,
}: {
	table: TableType<ProcessRecord>
	rows: Row<ProcessRecord>[]
	colLength: number
	loading: boolean
}) {
	const scrollRef = useRef<HTMLDivElement>(null)
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
		count: rows.length,
		estimateSize: () => 54,
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
					<ProcessTableHead table={table} />
					<TableBody>
						{rows.length ? (
							virtualRows.map((virtualRow) => {
								const row = rows[virtualRow.index]
								return <ProcessTableRow key={row.id} row={row} virtualRow={virtualRow} />
							})
						) : (
							<TableRow>
								<TableCell colSpan={colLength} className="h-37 text-center pointer-events-none">
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

function ProcessTableHead({ table }: { table: TableType<ProcessRecord> }) {
	return (
		<TableHeader className="sticky top-0 z-50 w-full border-b-2">
			{table.getHeaderGroups().map((headerGroup) => (
				<tr key={headerGroup.id}>
					{headerGroup.headers.map((header) => (
						<TableHead className="px-2" key={header.id}>
							{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
						</TableHead>
					))}
				</tr>
			))}
		</TableHeader>
	)
}

const ProcessTableRow = memo(function ProcessTableRow({
	row,
	virtualRow,
}: {
	row: Row<ProcessRecord>
	virtualRow: VirtualItem
}) {
	return (
		<TableRow>
			{row.getVisibleCells().map((cell) => (
				<TableCell key={cell.id} className="py-0" style={{ height: virtualRow.size }}>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	)
})
