package processes

// Process is a lightweight, read-only snapshot of a running process.
type Process struct {
	PID     int32   `json:"pid" cbor:"0,keyasint"`
	Name    string  `json:"name" cbor:"1,keyasint"`
	User    string  `json:"user,omitempty" cbor:"2,keyasint,omitempty"`
	Status  string  `json:"status" cbor:"3,keyasint"`
	CPU     float64 `json:"cpu" cbor:"4,keyasint"`
	Memory  uint64  `json:"memory" cbor:"5,keyasint"`
	Started int64   `json:"started,omitempty" cbor:"6,keyasint,omitempty"`
}

// Snapshot contains the current process list returned by an agent.
type Snapshot struct {
	Processes []Process `json:"processes" cbor:"0,keyasint"`
	Total     int       `json:"total" cbor:"1,keyasint"`
	Updated   int64     `json:"updated" cbor:"2,keyasint"`
}
