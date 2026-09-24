import { useLingui } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { memo, useEffect } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import UptimeTable from "@/components/uptime-table/uptime-table"
import { $allSystemsById } from "@/lib/stores"
import { useNetworkMonitors } from "@/lib/use-network-monitors"
import { supportsNetworkMonitors } from "@/lib/utils"

export default memo(() => {
	const { t } = useLingui()
	const { monitors, isLoading } = useNetworkMonitors({})
	const systems = useStore($allSystemsById)
	const visibleMonitors = monitors.filter((monitor) => {
		const system = systems[monitor.system]
		return !system || supportsNetworkMonitors(system)
	})

	useEffect(() => {
		document.title = `${t`Uptime`} / Beszel`
	}, [t])

	return (
		<>
			<div className="grid gap-4">
				<ActiveAlerts />
				<UptimeTable monitors={visibleMonitors} isLoading={isLoading} />
			</div>
			<FooterRepoLink />
		</>
	)
})
