/* =====================================================================
   violations.js — Violation Data, Types & Simulation Engine
   ===================================================================== */

const VIOLATION_TYPES = [
  { id: 'helmet',    label: 'Helmet Non-compliance', icon: '🪖', color: '#ff3b5c', severity: 'critical', weight: 22 },
  { id: 'seatbelt',  label: 'Seatbelt Non-compliance', icon: '🚗', color: '#ff9500', severity: 'high',    weight: 15 },
  { id: 'triple',    label: 'Triple Riding',          icon: '🏍️', color: '#ff6b35', severity: 'critical', weight: 10 },
  { id: 'wrongside', label: 'Wrong-Side Driving',     icon: '↔️', color: '#ff2d55', severity: 'critical', weight: 8  },
  { id: 'stopline',  label: 'Stop-Line Violation',    icon: '🛑', color: '#ffd60a', severity: 'high',     weight: 18 },
  { id: 'redlight',  label: 'Red-Light Violation',    icon: '🔴', color: '#ff3b5c', severity: 'critical', weight: 14 },
  { id: 'parking',   label: 'Illegal Parking',        icon: '🅿️', color: '#00c4b0', severity: 'medium',  weight: 13 },
];

const VEHICLE_TYPES = ['Car', 'Motorcycle', 'Truck', 'Bus', 'Auto-Rickshaw', 'Bicycle'];

const LOCATIONS = [
  'MG Road Junction', 'Silk Board Flyover', 'KR Puram Signal',
  'Whitefield Cross', 'Hebbal Junction', 'Electronic City Toll',
  'Marathahalli Bridge', 'Koramangala 4th Block', 'BTM Layout Signal',
  'Indiranagar 100ft Rd', 'Yelahanka Crossing', 'Bannerghatta Main',
];

const STATES = {
  'KA': 'Karnataka', 'MH': 'Maharashtra', 'TN': 'Tamil Nadu',
  'DL': 'Delhi', 'GJ': 'Gujarat', 'UP': 'Uttar Pradesh',
  'AP': 'Andhra Pradesh', 'TS': 'Telangana',
};

const PLATE_PREFIXES = ['KA12', 'KA01', 'MH02', 'TN09', 'DL4C', 'GJ05', 'UP32', 'AP11'];

// ─── Utility Functions ────────────────────────────────────────────────
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max, dec = 1) { return parseFloat((Math.random() * (max - min) + min).toFixed(dec)); }
function randFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generatePlate() {
  const prefix = randFrom(PLATE_PREFIXES);
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const l1 = letters[randInt(0, letters.length - 1)];
  const l2 = letters[randInt(0, letters.length - 1)];
  const num = String(randInt(1000, 9999));
  return `${prefix}${l1}${l2}${num}`;
}

function weightedRandViolation() {
  const total = VIOLATION_TYPES.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of VIOLATION_TYPES) { r -= v.weight; if (r <= 0) return v; }
  return VIOLATION_TYPES[0];
}

function timeAgo(seconds) {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  return `${Math.floor(seconds/3600)}h ago`;
}

function formatTimestamp(date) {
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Violation Record Generator ───────────────────────────────────────
let _violationIdCounter = 1000;

function generateViolation(overrides = {}) {
  const type = overrides.type || weightedRandViolation();
  const now = new Date();
  now.setSeconds(now.getSeconds() - randInt(0, 3600));
  return {
    id: `TVD-${++_violationIdCounter}`,
    type,
    plate: overrides.plate || generatePlate(),
    vehicle: overrides.vehicle || randFrom(VEHICLE_TYPES),
    location: overrides.location || randFrom(LOCATIONS),
    timestamp: now,
    confidence: randFloat(88, 99.8, 1),
    severity: type.severity,
    camera: `CAM-${randInt(1, 24).toString().padStart(2,'0')}`,
    lane: randInt(1, 4),
    speed: randFrom([null, null, null, `${randInt(45, 120)} km/h`]),
    weather: randFrom(['Clear', 'Overcast', 'Rain', 'Fog', 'Bright']),
    status: randFrom(['processed', 'processed', 'processed', 'pending', 'flagged']),
    imageIdx: randInt(0, 2),
  };
}

// ─── Bulk Data Generation ─────────────────────────────────────────────
function generateDataset(count = 200) {
  const records = [];
  for (let i = 0; i < count; i++) {
    records.push(generateViolation());
  }
  return records;
}

// ─── Hourly Data ──────────────────────────────────────────────────────
function generateHourlyData() {
  const hours = Array.from({length: 24}, (_, i) => i);
  return hours.map(h => {
    // Traffic patterns: peaks at 8-10am and 5-8pm
    const morning = Math.exp(-0.5 * Math.pow((h - 9) / 1.5, 2));
    const evening = Math.exp(-0.5 * Math.pow((h - 18) / 2, 2));
    const base = (morning + evening) * 35;
    return Math.round(base + randInt(0, 8));
  });
}

// ─── 30-Day Trend ────────────────────────────────────────────────────
function generate30DayTrend() {
  const data = [];
  let val = randInt(80, 120);
  for (let i = 0; i < 30; i++) {
    val += randInt(-12, 15);
    val = Math.max(30, Math.min(200, val));
    data.push(val);
  }
  return data;
}

// ─── Per-class Performance Data ───────────────────────────────────────
const CLASS_PERFORMANCE = [
  { name: 'Helmet Non-compliance', precision: 96.2, recall: 95.1, f1: 95.6, mAP: 97.8, samples: 8420 },
  { name: 'Seatbelt Non-compliance', precision: 93.5, recall: 92.8, f1: 93.1, mAP: 95.2, samples: 5620 },
  { name: 'Triple Riding',          precision: 91.2, recall: 89.7, f1: 90.4, mAP: 93.6, samples: 3180 },
  { name: 'Wrong-Side Driving',     precision: 97.8, recall: 96.5, f1: 97.1, mAP: 98.4, samples: 2750 },
  { name: 'Stop-Line Violation',    precision: 94.6, recall: 93.2, f1: 93.9, mAP: 96.1, samples: 6840 },
  { name: 'Red-Light Violation',    precision: 98.2, recall: 97.4, f1: 97.8, mAP: 99.1, samples: 5320 },
  { name: 'Illegal Parking',        precision: 92.1, recall: 91.3, f1: 91.7, mAP: 94.0, samples: 4870 },
];

// ─── Registration DB Simulation ───────────────────────────────────────
const VEHICLE_COLORS = ['White', 'Black', 'Silver', 'Red', 'Blue', 'Grey', 'Dark Blue', 'Maroon'];
const VEHICLE_MAKES = ['Maruti Suzuki', 'Hyundai', 'Tata', 'Honda', 'Toyota', 'Hero MotoCorp', 'Bajaj', 'Royal Enfield', 'Yamaha'];
const VEHICLE_MODELS = {
  'Maruti Suzuki': ['Swift', 'Alto', 'Baleno', 'Vitara Brezza', 'Wagon R'],
  'Hyundai':       ['i20', 'Creta', 'Verna', 'Grand i10'],
  'Tata':          ['Nexon', 'Punch', 'Harrier', 'Tiago'],
  'Honda':         ['City', 'Amaze', 'WR-V', 'Jazz'],
  'Toyota':        ['Innova', 'Fortuner', 'Camry', 'Glanza'],
  'Hero MotoCorp': ['Splendor', 'Glamour', 'Passion', 'Xpulse'],
  'Bajaj':         ['Pulsar', 'Avenger', 'Dominar', 'CT 100'],
  'Royal Enfield': ['Classic 350', 'Bullet 350', 'Meteor', 'Hunter 350'],
  'Yamaha':        ['FZ-S', 'R15', 'MT-15', 'Fascino'],
};

function lookupPlate(plateNum) {
  // Deterministic based on plate hash
  const hash = plateNum.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const make = VEHICLE_MAKES[hash % VEHICLE_MAKES.length];
  const models = VEHICLE_MODELS[make];
  const model = models[hash % models.length];
  const color = VEHICLE_COLORS[(hash * 7) % VEHICLE_COLORS.length];
  const year = 2015 + (hash % 9);
  const stateKeys = Object.keys(STATES);
  const state = STATES[stateKeys[hash % stateKeys.length]];
  const flagged = hash % 7 === 0;
  const prevViolations = hash % 12;

  return {
    plate: plateNum.toUpperCase(),
    owner: generateOwnerName(hash),
    make, model, color, year, state,
    type: make.includes('Hero') || make === 'Bajaj' || make === 'Royal Enfield' || make === 'Yamaha' ? 'Motorcycle' : 'Car',
    rto: `RTO-${stateKeys[hash % stateKeys.length]}${(hash % 99) + 1}`,
    insurance: flagged ? 'EXPIRED' : 'VALID',
    fitness: (hash * 3) % 5 === 0 ? 'EXPIRED' : 'VALID',
    previousViolations: prevViolations,
    flagged,
  };
}

function generateOwnerName(seed) {
  const firstNames = ['Arjun', 'Priya', 'Rahul', 'Anita', 'Suresh', 'Kavitha', 'Ravi', 'Deepa', 'Vijay', 'Sunitha'];
  const lastNames  = ['Kumar', 'Sharma', 'Reddy', 'Nair', 'Patel', 'Singh', 'Rao', 'Menon', 'Joshi', 'Gupta'];
  return `${firstNames[seed % firstNames.length]} ${lastNames[(seed * 3) % lastNames.length]}`;
}

// ─── Export ───────────────────────────────────────────────────────────
window.ViolationData = {
  VIOLATION_TYPES, VEHICLE_TYPES, LOCATIONS, CLASS_PERFORMANCE,
  generateViolation, generateDataset, generateHourlyData,
  generate30DayTrend, generatePlate, lookupPlate,
  randInt, randFloat, randFrom, weightedRandViolation, timeAgo,
};
