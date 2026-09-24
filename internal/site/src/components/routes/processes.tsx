import { useLingui } from "@lingui/react/macro"
import { memo, useEffect } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import ProcessesTable from "@/components/processes-table/processes-table"

export default memo(() => {
	const { t } = useLingui()

	useEffect(() => {
		document.title = `${t`Processes`} / Beszel`
	}, [t])

	return (
		<>
			<div className="grid gap-4">
				<ActiveAlerts />
				<ProcessesTable />
			</div>
			<FooterRepoLink />
		</>
	)
})
