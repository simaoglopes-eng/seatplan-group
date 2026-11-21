// Deposit payments: the diner's payment pages and the owner's deposit rules.
import { api } from "./client";
import type { PaymentStatus } from "./restaurant";

/** Where a deposit stands (GET /payments/{id}). */
export interface PaymentState {
  status: PaymentStatus;
  booking_status: string;
  amount_cents: number;
  expires_at: string;
  restaurant: string;
  restaurant_slug: string | null;
  /** "demo" while no real money moves. */
  mode: string;
  /** Only on the demo page's answer: the pretend card was refused. */
  declined?: boolean;
}

const pay = (id: string): string => `/payments/${encodeURIComponent(id)}`;

export const getPayment = (id: string) => api.get<PaymentState>(pay(id), "none");
export const payDemo = (id: string, outcome: "ok" | "decline") => api.post<PaymentState>(`/payments/demo/${encodeURIComponent(id)}`, { outcome }, "none");
export const abandonPayment = (id: string) => api.post<PaymentState>(`${pay(id)}/abandon`, {}, "none");
export const retryPayment = (id: string) => api.post<{ next_url: string }>(`${pay(id)}/retry`, {}, "none");

/** One deposit rule. `service_name` "" means every service without a rule of its own. */
export interface DepositRule {
  service_name: string;
  per_person_cents: number;
  cancel_hours: number;
  min_party: number;
}

/** The owner's deposit settings (GET /owner/restaurants/{vid}/payments). */
export interface PaymentSettings {
  payments_mode: "demo" | "test" | "live";
  /** False until online payments are connected: the form then explains why. */
  available: boolean;
  minimum_cents: number;
  max_per_person_cents: number;
  cancel_hours: number[];
  services: string[];
  policies: DepositRule[];
}

const owner = (vid: string): string => `/owner/restaurants/${encodeURIComponent(vid)}/payments`;
export const getPaymentSettings = (vid: string) => api.get<PaymentSettings>(owner(vid));
export const savePaymentSettings = (vid: string, policies: DepositRule[]) => api.put<PaymentSettings>(owner(vid), { policies });
