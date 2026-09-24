package agent

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCalculateProcessCPU(t *testing.T) {
	assert.InDelta(t, 25.0, calculateProcessCPU(10, 10.5, 2), 0.001)
	assert.Zero(t, calculateProcessCPU(10, 10.5, 0))
	assert.Zero(t, calculateProcessCPU(10, 9, 2))
}

func TestNormalizeProcessStatus(t *testing.T) {
	tests := map[string]string{
		"R":       "running",
		"running": "running",
		"S":       "sleeping",
		"sleep":   "sleeping",
		"T":       "stopped",
		"stop":    "stopped",
		"I":       "idle",
		"idle":    "idle",
		"Z":       "zombie",
		"zombie":  "zombie",
		"W":       "waiting",
		"blocked": "waiting",
		"L":       "locked",
		"lock":    "locked",
		"X":       "unknown",
	}
	for input, expected := range tests {
		assert.Equal(t, expected, normalizeProcessStatus([]string{input}))
	}
	assert.Equal(t, "unknown", normalizeProcessStatus(nil))
}
