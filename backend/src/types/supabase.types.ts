/**
 * Supabase Veritabanı Tip Tanımlamaları
 * Supabase client'ın tip güvenliği için kullanılır.
 * Bu dosya Supabase CLI ile de otomatik üretilebilir.
 */

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          phone: string;
          full_name: string;
          password_hash: string;
          avatar_url: string | null;
          role: 'customer' | 'driver';
          rating: number;
          rating_count: number;
          refresh_token: string | null;
          session_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          phone: string;
          full_name: string;
          password_hash: string;
          avatar_url?: string | null;
          role?: 'customer' | 'driver';
          rating?: number;
          rating_count?: number;
          refresh_token?: string | null;
          session_version?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          full_name?: string;
          password_hash?: string;
          avatar_url?: string | null;
          role?: 'customer' | 'driver';
          rating?: number;
          rating_count?: number;
          refresh_token?: string | null;
          session_version?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      drivers: {
        Row: {
          id: string;
          vehicle_plate: string;
          vehicle_model: string;
          vehicle_color: string;
          is_online: boolean;
          is_available: boolean;
          current_location: unknown;
          last_location_update: string | null;
          total_rides: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          vehicle_plate: string;
          vehicle_model: string;
          vehicle_color: string;
          is_online?: boolean;
          is_available?: boolean;
          current_location?: unknown;
          last_location_update?: string | null;
          total_rides?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vehicle_plate?: string;
          vehicle_model?: string;
          vehicle_color?: string;
          is_online?: boolean;
          is_available?: boolean;
          current_location?: unknown;
          last_location_update?: string | null;
          total_rides?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      rides: {
        Row: {
          id: string;
          customer_id: string;
          driver_id: string | null;
          pickup_location: unknown;
          dropoff_location: unknown;
          pickup_address: string;
          dropoff_address: string;
          distance_km: number | null;
          estimated_price: number;
          final_price: number | null;
          status: 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';
          requested_at: string;
          accepted_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          customer_id: string;
          driver_id?: string | null;
          pickup_location: unknown;
          dropoff_location: unknown;
          pickup_address: string;
          dropoff_address: string;
          distance_km?: number | null;
          estimated_price: number;
          final_price?: number | null;
          status?: 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';
          requested_at?: string;
          accepted_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          customer_id?: string;
          driver_id?: string | null;
          pickup_location?: unknown;
          dropoff_location?: unknown;
          pickup_address?: string;
          dropoff_address?: string;
          distance_km?: number | null;
          estimated_price?: number;
          final_price?: number | null;
          status?: 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';
          requested_at?: string;
          accepted_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      reviews: {
        Row: {
          id: string;
          ride_id: string;
          reviewer_id: string;
          reviewed_id: string;
          rating: number;
          comment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ride_id: string;
          reviewer_id: string;
          reviewed_id: string;
          rating: number;
          comment?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          ride_id?: string;
          reviewer_id?: string;
          reviewed_id?: string;
          rating?: number;
          comment?: string | null;
          created_at?: string;
        };
      };
      driver_locations_history: {
        Row: {
          id: number;
          driver_id: string;
          location: unknown;
          bearing: number | null;
          speed: number | null;
          recorded_at: string;
        };
        Insert: {
          id?: number;
          driver_id: string;
          location: unknown;
          bearing?: number | null;
          speed?: number | null;
          recorded_at?: string;
        };
        Update: {
          id?: number;
          driver_id?: string;
          location?: unknown;
          bearing?: number | null;
          speed?: number | null;
          recorded_at?: string;
        };
      };
    };
    Functions: {
      find_nearby_drivers: {
        Args: {
          lat: number;
          lng: number;
          radius_meters?: number;
          max_results?: number;
        };
        Returns: {
          driver_id: string;
          full_name: string;
          phone: string;
          vehicle_plate: string;
          vehicle_model: string;
          vehicle_color: string;
          rating: number;
          distance_meters: number;
          lat_out: number;
          lng_out: number;
        }[];
      };
      update_driver_location: {
        Args: {
          p_driver_id: string;
          p_lat: number;
          p_lng: number;
          p_bearing?: number;
          p_speed?: number;
        };
        Returns: void;
      };
      get_ride_stats: {
        Args: {
          p_user_id: string;
        };
        Returns: {
          total_rides: number;
          completed_rides: number;
          cancelled_rides: number;
          total_spent: number;
          avg_rating: number;
        }[];
      };
      cleanup_old_location_history: {
        Args: Record<string, never>;
        Returns: number;
      };
    };
    Enums: {
      user_role: 'customer' | 'driver';
      ride_status: 'searching' | 'accepted' | 'arriving' | 'in_progress' | 'completed' | 'cancelled';
    };
  };
}
