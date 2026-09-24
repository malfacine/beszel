import { t } from "@lingui/core/macro"
import type { Column, ColumnDef } from "@tanstack/react-table"
import {
	ActivityIcon,
	ArrowUpDownIcon,
	Clock3Icon,
	CpuIcon,
	HashIcon,
	ListTreeIcon,
	MemoryStickIcon,
	ServerIcon,
	UserRoundIcon,
} from "lucide-react"
import { useStore } from "@nanostores/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { $allSystemsById, $longestSystemName } from "@/lib/stores"
import { cn, decimalString, formatBytes } from "@/lib/utils"
import type { ProcessRecord, ProcessStatus } from "@/types"

export function getProcessStatusLabel(status: ProcessStatus) {
	switch (status) {
		case "running":
			return t`Running`
		case "sleeping":
			return t`Sleeping`
		case "stopped":
			return t`Stopped`
		case "idle":
			return t`Idle`
		case "zombie":
			return t`Zombie`
		case "waiting":
			return t`Waiting`
		case "locked":
			return t`Locked`
		default:
			return t`Unknown`
	}
}

function getProcessStatusColor(status: ProcessStatus) {
	switch (status) {
		case "running":
			return "bg-green-500"
		case "zombie":
			return "bg-red-500"
		case "stopped":
		case "waiting":
		case "locked":
			return "bg-yellow-500"
		default:
			return "bg-zinc-500"
	}
}

export const processTableColumns: ColumnDef<ProcessRecord>[] = [
	{
		id: "name",
		accessorFn: (record) => record.name,
		sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
		header: ({ column }) => <HeaderButton column={column} name={t`Name`} Icon={ListTreeIcon} />,
		cell: ({ getValue }) => <span className="ms-1.5 xl:w-50 block truncate">{getValue() as string}</span>,
	},
	{
		id: "system",
		accessorFn: (record) => record.system,
		sortingFn: (a, b) => {
			const systems = $allSystemsById.get()
			const primary = (systems[a.original.system]?.name ?? "").localeCompare(systems[b.original.system]?.name ?? "")
			return primary || b.original.cpu - a.original.cpu
		},
		header: ({ column }) => <HeaderButton column={column} name={t`System`} Icon={ServerIcon} />,
		cell: ({ getValue }) => {
			const systems = useStore($allSystemsById)
			const longestName = useStore($longestSystemName)
			return (
				<div className="ms-1 relative w-fit max-w-40">
					<span className="invisible block whitespace-nowrap" aria-hidden="true">
						{longestName}
					</span>
					<span className="absolute inset-0 truncate">{systems[getValue() as string]?.name ?? ""}</span>
				</div>
			)
		},
	},
	{
		id: "state",
		accessorFn: (record) => record.status,
		header: ({ column }) => <HeaderButton column={column} name={t`State`} Icon={ActivityIcon} />,
		cell: ({ getValue }) => {
			const status = getValue() as ProcessStatus
			return (
				<Badge variant="outline" className="dark:border-white/12">
					<span className={cn("size-2 me-1.5 rounded-full", getProcessStatusColor(status))} />
					{getProcessStatusLabel(status)}
				</Badge>
			)
		},
	},
	{
		id: "cpu",
		accessorFn: (record) => record.cpu,
		invertSorting: true,
		header: ({ column }) => <HeaderButton column={column} name={t`CPU`} Icon={CpuIcon} />,
		cell: ({ getValue }) => {
			const value = getValue() as number
			return <span className="ms-1.5 tabular-nums">{`${decimalString(value, value >= 10 ? 1 : 2)}%`}</span>
		},
	},
	{
		id: "memory",
		accessorFn: (record) => record.memory,
		invertSorting: true,
		header: ({ column }) => <HeaderButton column={column} name={t`Memory`} Icon={MemoryStickIcon} />,
		cell: ({ getValue }) => {
			const formatted = formatBytes(getValue() as number, false, undefined, false)
			return (
				<span className="ms-1.5 tabular-nums">{`${decimalString(formatted.value, formatted.value >= 10 ? 1 : 2)} ${formatted.unit}`}</span>
			)
		},
	},
	{
		id: "pid",
		accessorFn: (record) => record.pid,
		header: ({ column }) => <HeaderButton column={column} name="PID" Icon={HashIcon} />,
		cell: ({ getValue }) => <span className="ms-1.5 tabular-nums">{getValue() as number}</span>,
	},
	{
		id: "user",
		accessorFn: (record) => record.user ?? "",
		header: ({ column }) => <HeaderButton column={column} name={t`User`} Icon={UserRoundIcon} />,
		cell: ({ getValue }) => {
			const value = getValue() as string
			return (
				<span className={cn("ms-1.5 max-w-44 block truncate", !value && "text-muted-foreground")}>
					{value || "N/A"}
				</span>
			)
		},
	},
	{
		id: "started",
		accessorFn: (record) => record.started ?? 0,
		header: ({ column }) => <HeaderButton column={column} name={t`Started`} Icon={Clock3Icon} />,
		cell: ({ getValue }) => {
			const value = getValue() as number
			return (
				<span className={cn("ms-1.5 tabular-nums", !value && "text-muted-foreground")}>
					{value ? new Date(value).toLocaleString() : "N/A"}
				</span>
			)
		},
	},
]

function HeaderButton({
	column,
	name,
	Icon,
}: {
	column: Column<ProcessRecord>
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
			onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
		>
			<Icon className="size-4" />
			{name}
			<ArrowUpDownIcon className="size-4" />
		</Button>
	)
}
