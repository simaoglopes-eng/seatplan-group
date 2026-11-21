import { api } from "./client";

export interface MenuItem {
  name: string;
  category: string;
  description: string;
  price_cents: number;
  allergens: string;
  available: boolean;
}
export interface RestaurantMenu { version: number; items: MenuItem[] }
export const getOwnerMenu = (id: string) => api.get<RestaurantMenu>(`/owner/restaurants/${encodeURIComponent(id)}/menu`);
export const saveOwnerMenu = (id: string, menu: RestaurantMenu) => api.put<RestaurantMenu>(`/owner/restaurants/${encodeURIComponent(id)}/menu`, menu);
export const getPublicMenu = (slug: string) => api.get<{ currency: "EUR"; items: MenuItem[] }>(`/restaurants/${encodeURIComponent(slug)}/menu`, "none");
