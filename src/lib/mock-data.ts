// FaceValue — mock data (disclosed mock: 3-event catalog, no real venue integration).
// All money in integer USDC cents to mirror on-chain fixed-point. ZK fields are illustrative.

export type EventId = "evt-aurora" | "evt-derby" | "evt-hamlet";

export interface EventInfo {
  id: EventId;
  name: string;
  subtitle: string;
  venue: string;
  city: string;
  /** ISO date of the event */
  date: string;
  /** public, regulated per-event face-value cap, in USDC cents */
  faceValueCapCents: number;
  /** total tickets issued into the Merkle set (mock) */
  issuedCount: number;
  /** short illustrative merkle root for the issued-ticket set */
  merkleRoot: string;
  category: "concert" | "sport" | "theatre";
}

export type TicketStatus = "active" | "listed" | "nullified";

export interface Ticket {
  id: string;
  eventId: EventId;
  /** human serial printed on the stub */
  serial: string;
  section: string;
  row: string;
  seat: string;
  status: TicketStatus;
  /** the price the current holder paid, in cents — PRIVATE on-chain (masked in UI) */
  paidPriceCents: number;
  /** deterministic seed for the QR (mock) */
  qrSeed: string;
  /** Poseidon-style leaf commitment (illustrative) */
  commitment: string;
}

export type TxKind = "issue" | "resale-accept" | "resale-reject" | "nullify" | "door-scan";

export interface TxRecord {
  hash: string;
  kind: TxKind;
  status: "success" | "rejected";
  ledger: number;
  /** unix seconds (mock, fixed for deterministic demo) */
  ts: number;
  ticketId: string;
  /** public ZK inputs surfaced for judge credibility */
  publicInputs: {
    perEventCapCents: number;
    merkleRoot: string;
    nullifier: string;
  };
  /** only present on reject, the human reason */
  rejectReason?: string;
}

/** Selective-disclosure record: hidden by default, reconstructed via a valid view key. */
export interface AuditRecord {
  ticketId: string;
  txHash: string;
  buyerAddress: string;
  sellerAddress: string;
  exactPriceCents: number;
  viewKey: string;
  merkleRoot: string;
  nullifier: string;
}

export const EVENTS: EventInfo[] = [
  {
    id: "evt-aurora",
    name: "AURORA SKYLINE",
    subtitle: "Continental Tour ’26 — Night 2",
    venue: "Meridian Arena",
    city: "London",
    date: "2026-08-14",
    faceValueCapCents: 12000, // $120.00 cap
    issuedCount: 18450,
    merkleRoot: "0x9f2c…a417",
    category: "concert",
  },
  {
    id: "evt-derby",
    name: "CITY vs ROVERS",
    subtitle: "Cup Final — North Stand",
    venue: "Kingsford Ground",
    city: "Manchester",
    date: "2026-07-05",
    faceValueCapCents: 9000, // $90.00 cap
    issuedCount: 42100,
    merkleRoot: "0x3b71…ce90",
    category: "sport",
  },
  {
    id: "evt-hamlet",
    name: "HAMLET",
    subtitle: "A New Staging — Press Week",
    venue: "The Lyric Rooms",
    city: "Edinburgh",
    date: "2026-09-22",
    faceValueCapCents: 25000, // $250.00 cap
    issuedCount: 1180,
    merkleRoot: "0xc40e…11d8",
    category: "theatre",
  },
];

export const TICKETS: Ticket[] = [
  {
    id: "tkt-AUR-0481",
    eventId: "evt-aurora",
    serial: "AUR-0481-2X",
    section: "FLOOR A",
    row: "C",
    seat: "14",
    status: "active",
    paidPriceCents: 12000,
    qrSeed: "AUR0481-seed-9931",
    commitment: "0x71a0…44ef",
  },
  {
    id: "tkt-AUR-0482",
    eventId: "evt-aurora",
    serial: "AUR-0482-7K",
    section: "TIER 2",
    row: "M",
    seat: "208",
    status: "listed",
    paidPriceCents: 9000,
    qrSeed: "AUR0482-seed-1187",
    commitment: "0x55cd…9a20",
  },
  {
    id: "tkt-DBY-3390",
    eventId: "evt-derby",
    serial: "DBY-3390-1A",
    section: "NORTH",
    row: "22",
    seat: "9",
    status: "active",
    paidPriceCents: 8500,
    qrSeed: "DBY3390-seed-5521",
    commitment: "0x0fae…73bc",
  },
  {
    id: "tkt-HAM-0044",
    eventId: "evt-hamlet",
    serial: "HAM-0044-5P",
    section: "STALLS",
    row: "F",
    seat: "3",
    status: "nullified",
    paidPriceCents: 6500,
    qrSeed: "HAM0044-seed-7740",
    commitment: "0x2d91…e6f1",
  },
];

export const TX_HISTORY: TxRecord[] = [
  {
    hash: "0xa71f4c9e2b8d6011f3aa90cd44e7b215c0d9f8e3a26b7140",
    kind: "issue",
    status: "success",
    ledger: 58_120_447,
    ts: 1_750_000_000,
    ticketId: "tkt-AUR-0481",
    publicInputs: { perEventCapCents: 12000, merkleRoot: "0x9f2c…a417", nullifier: "—" },
  },
  {
    hash: "0xc0d9f8e3a26b7140a71f4c9e2b8d6011f3aa90cd44e7b215",
    kind: "resale-reject",
    status: "rejected",
    ledger: 58_120_991,
    ts: 1_750_003_600,
    ticketId: "tkt-AUR-0482",
    publicInputs: { perEventCapCents: 12000, merkleRoot: "0x9f2c…a417", nullifier: "0x88be…1c4a" },
    rejectReason: "resale_price ($210.00) > per_event_cap ($120.00)",
  },
];

export const AUDIT_RECORDS: AuditRecord[] = [
  {
    ticketId: "tkt-AUR-0482",
    txHash: "0x4417bb20e9…accept",
    buyerAddress: "GBUY…7Q2X",
    sellerAddress: "GSEL…3K9D",
    exactPriceCents: 11500, // $115.00 — at/below cap
    viewKey: "vk_aur_9f31c0",
    merkleRoot: "0x9f2c…a417",
    nullifier: "0x88be…1c4a",
  },
];

// ---- helpers ----
export const fmtUSD = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const eventById = (id: EventId) => EVENTS.find((e) => e.id === id)!;
export const ticketsForEvent = (id: EventId) => TICKETS.filter((t) => t.eventId === id);
