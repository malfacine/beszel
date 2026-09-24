package agent

import (
	"context"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	processEntity "github.com/henrygd/beszel/internal/entities/processes"
	gprocess "github.com/shirou/gopsutil/v4/process"
)

const maxProcessSnapshotSize = 500

type processCPUSample struct {
	name    string
	started int64
	total   float64
}

// processManager keeps only the previous CPU sample. It does no background work.
type processManager struct {
	sync.Mutex
	lastSnapshot time.Time
	previousCPU  map[int32]processCPUSample
}

func newProcessManager() *processManager {
	return &processManager{previousCPU: make(map[int32]processCPUSample)}
}

func (pm *processManager) getSnapshot() (processEntity.Snapshot, error) {
	pm.Lock()
	defer pm.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	now := time.Now()
	elapsed := now.Sub(pm.lastSnapshot).Seconds()
	processList, err := gprocess.ProcessesWithContext(ctx)
	if err != nil {
		return processEntity.Snapshot{}, err
	}

	items := make([]processEntity.Process, 0, len(processList))
	nextCPU := make(map[int32]processCPUSample, len(processList))
	for _, proc := range processList {
		name, err := proc.NameWithContext(ctx)
		if err != nil || name == "" {
			continue
		}

		started, _ := proc.CreateTimeWithContext(ctx)
		cpuTotal := 0.0
		if times, err := proc.TimesWithContext(ctx); err == nil {
			cpuTotal = times.User + times.System
		}

		cpuPercent := 0.0
		if previous, ok := pm.previousCPU[proc.Pid]; ok && previous.name == name && previous.started == started {
			cpuPercent = calculateProcessCPU(previous.total, cpuTotal, elapsed)
		}
		nextCPU[proc.Pid] = processCPUSample{name: name, started: started, total: cpuTotal}

		memory := uint64(0)
		if memoryInfo, err := proc.MemoryInfoWithContext(ctx); err == nil && memoryInfo != nil {
			memory = memoryInfo.RSS
		}

		username, _ := proc.UsernameWithContext(ctx)
		if username == "" {
			if uids, err := proc.UidsWithContext(ctx); err == nil && len(uids) > 0 {
				username = "UID " + strconv.FormatUint(uint64(uids[0]), 10)
			}
		}
		statuses, _ := proc.StatusWithContext(ctx)
		items = append(items, processEntity.Process{
			PID:     proc.Pid,
			Name:    name,
			User:    username,
			Status:  normalizeProcessStatus(statuses),
			CPU:     math.Round(cpuPercent*100) / 100,
			Memory:  memory,
			Started: started,
		})
	}

	pm.previousCPU = nextCPU
	pm.lastSnapshot = now

	sort.Slice(items, func(i, j int) bool {
		if items[i].CPU != items[j].CPU {
			return items[i].CPU > items[j].CPU
		}
		if items[i].Memory != items[j].Memory {
			return items[i].Memory > items[j].Memory
		}
		if nameOrder := strings.Compare(items[i].Name, items[j].Name); nameOrder != 0 {
			return nameOrder < 0
		}
		return items[i].PID < items[j].PID
	})

	total := len(items)
	if len(items) > maxProcessSnapshotSize {
		items = items[:maxProcessSnapshotSize]
	}
	return processEntity.Snapshot{Processes: items, Total: total, Updated: now.UnixMilli()}, nil
}

func calculateProcessCPU(previous, current, elapsed float64) float64 {
	if elapsed <= 0 || current <= previous {
		return 0
	}
	return (current - previous) / elapsed * 100
}

func normalizeProcessStatus(statuses []string) string {
	if len(statuses) == 0 {
		return "unknown"
	}
	switch strings.ToLower(statuses[0]) {
	case "r", "running":
		return "running"
	case "s", "sleep", "sleeping":
		return "sleeping"
	case "t", "stop", "stopped":
		return "stopped"
	case "i", "idle":
		return "idle"
	case "z", "zombie":
		return "zombie"
	case "d", "u", "w", "blocked", "wait", "waiting":
		return "waiting"
	case "l", "lock", "locked":
		return "locked"
	default:
		return "unknown"
	}
}
