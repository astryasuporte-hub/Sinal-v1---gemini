/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          plan_name: string;
          subscription_status: string;
          trial_ends_at: string | null;
          is_admin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          plan_name?: string;
          subscription_status?: string;
          trial_ends_at?: string | null;
          is_admin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          plan_name?: string;
          subscription_status?: string;
          trial_ends_at?: string | null;
          is_admin?: boolean;
          updated_at?: string;
        };
      };
      user_preferences: {
        Row: {
          id: string;
          email_morning_briefing: boolean;
          email_evening_briefing: boolean;
          email_breaking_alerts: boolean;
          weekend_edition: boolean;
          briefing_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email_morning_briefing?: boolean;
          email_evening_briefing?: boolean;
          email_breaking_alerts?: boolean;
          weekend_edition?: boolean;
          briefing_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email_morning_briefing?: boolean;
          email_evening_briefing?: boolean;
          email_breaking_alerts?: boolean;
          weekend_edition?: boolean;
          briefing_email?: string | null;
          updated_at?: string;
        };
      };
      events: {
        Row: {
          id: string;
          title: string;
          summary: string;
          what_happened: string;
          why_it_matters: string;
          category: string;
          relevance_score: number;
          image_url: string | null;
          published_at: string;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id: string;
          title: string;
          summary: string;
          what_happened: string;
          why_it_matters: string;
          category?: string;
          relevance_score?: number;
          image_url?: string | null;
          published_at?: string;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          title?: string;
          summary?: string;
          what_happened?: string;
          why_it_matters?: string;
          category?: string;
          relevance_score?: number;
          image_url?: string | null;
          updated_at?: string;
        };
      };
      sources: {
        Row: {
          id: string;
          name: string;
          domain: string;
          category: string;
          brand_color: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          domain: string;
          category?: string;
          brand_color?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          domain?: string;
          category?: string;
          brand_color?: string | null;
        };
      };
      topics: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          category: string;
          brand_color: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          slug: string;
          description?: string | null;
          category?: string;
          brand_color?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          description?: string | null;
          category?: string;
          brand_color?: string | null;
        };
      };
      entities: {
        Row: {
          id: string;
          name: string;
          type: 'company' | 'person' | 'organization';
          description: string | null;
          sector: string | null;
          role: string | null;
          organization: string | null;
          website: string | null;
          avatar_url: string | null;
          brand_color: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          type: 'company' | 'person' | 'organization';
          description?: string | null;
          sector?: string | null;
          role?: string | null;
          organization?: string | null;
          website?: string | null;
          avatar_url?: string | null;
          brand_color?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          type?: 'company' | 'person' | 'organization';
          description?: string | null;
          sector?: string | null;
          role?: string | null;
          organization?: string | null;
          website?: string | null;
          avatar_url?: string | null;
          brand_color?: string | null;
        };
      };
      user_saved_events: {
        Row: {
          user_id: string;
          event_id: string;
          saved_at: string;
        };
        Insert: {
          user_id: string;
          event_id: string;
          saved_at?: string;
        };
        Update: {
          saved_at?: string;
        };
      };
      user_followed_topics: {
        Row: {
          user_id: string;
          topic_id: string;
          followed_at: string;
        };
        Insert: {
          user_id: string;
          topic_id: string;
          followed_at?: string;
        };
        Update: {
          followed_at?: string;
        };
      };
      user_followed_entities: {
        Row: {
          user_id: string;
          entity_id: string;
          followed_at: string;
        };
        Insert: {
          user_id: string;
          entity_id: string;
          followed_at?: string;
        };
        Update: {
          followed_at?: string;
        };
      };
      user_followed_sources: {
        Row: {
          user_id: string;
          source_id: string;
          followed_at: string;
        };
        Insert: {
          user_id: string;
          source_id: string;
          followed_at?: string;
        };
        Update: {
          followed_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

