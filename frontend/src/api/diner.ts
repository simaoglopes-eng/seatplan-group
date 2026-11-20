import { api } from "./client";

export interface DinerBooking {
  id: string;
  restaurant: { public_id: string; name: string; slug: string | null };
  date: string;
  time: string;
  party_size: number;
  status: string;
  tables: string[];
  can_cancel: boolean;
}
export interface FavoriteRestaurant { slug: string; name: string }
export const getDinerBookings = (offset = 0) => api.get<{ items: DinerBooking[]; total: number }>(`/diner/bookings?offset=${offset}`, "guest");
export const cancelDinerBooking = (id: string) => api.delete<DinerBooking>(`/diner/bookings/${encodeURIComponent(id)}`, "guest");
export const getFavorites = () => api.get<{ items: FavoriteRestaurant[] }>("/diner/favorites", "guest");
export const saveFavorite = (slug: string) => api.put(`/diner/favorites/${encodeURIComponent(slug)}`, {}, "guest");
export const removeFavorite = (slug: string) => api.delete(`/diner/favorites/${encodeURIComponent(slug)}`, "guest");
