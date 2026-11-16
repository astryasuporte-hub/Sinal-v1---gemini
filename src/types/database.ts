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
          user_id: string;
          name: string | null;
          username: string | null;
          avatar_url: string | null;
          timezone: string | null;
          locale: string | null;
          onboarding_status: string;
          onboarding_step: number | null;
          onboarding_completed_at: string | null;
          onboarding_data: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          locale?: string | null;
          onboarding_status?: string;
          onboarding_step?: number | null;
          onboarding_completed_at?: string | null;
          onboarding_data?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          locale?: string | null;
          onboarding_status?: string;
          onboarding_step?: number | null;
          onboarding_completed_at?: string | null;
          onboarding_data?: Json | null;
          updated_at?: string;
        };
      };
      user_settings: {
        Row: {
          id: string;
          user_id: string;
          email_morning_briefing?: boolean;
          email_evening_briefing?: boolean;
          email_breaking_alerts?: boolean;
          weekend_edition?: boolean;
          briefing_email?: string | null;
          morning_time?: string | null;
          evening_time?: string | null;
          timezone?: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          email_morning_briefing?: boolean;
          email_evening_briefing?: boolean;
          email_breaking_alerts?: boolean;
          weekend_edition?: boolean;
          briefing_email?: string | null;
          morning_time?: string | null;
          evening_time?: string | null;
          timezone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email_morning_briefing?: boolean;
          email_evening_briefing?: boolean;
          email_breaking_alerts?: boolean;
          weekend_edition?: boolean;
          briefing_email?: string | null;
          morning_time?: string | null;
          evening_time?: string | null;
          timezone?: string | null;
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
          morning_time: string | null;
          evening_time: string | null;
          timezone: string | null;
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
          morning_time?: string | null;
          evening_time?: string | null;
          timezone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email_morning_briefing?: boolean;
          email_evening_briefing?: boolean;
          email_breaking_alerts?: boolean;
          weekend_edition?: boolean;
          briefing_email?: string | null;
          morning_time?: string | null;
          evening_time?: string | null;
          timezone?: string | null;
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
      user_topic_follows: {
        Row: {
          id?: string;
          user_id: string;
          topic_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          topic_id: string;
          created_at?: string;
        };
        Update: {
          created_at?: string;
        };
      };
      user_entity_follows: {
        Row: {
          id?: string;
          user_id: string;
          entity_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          entity_id: string;
          created_at?: string;
        };
        Update: {
          created_at?: string;
        };
      };
      user_source_follows: {
        Row: {
          id?: string;
          user_id: string;
          source_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_id: string;
          created_at?: string;
        };
        Update: {
          created_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          subtitle: string | null;
          category: string;
          read: boolean;
          event_id: string | null;
          entity_id: string | null;
          metadata: Record<string, any>;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          subtitle?: string | null;
          category?: string;
          read?: boolean;
          event_id?: string | null;
          entity_id?: string | null;
          metadata?: Record<string, any>;
          created_at?: string;
        };
        Update: {
          title?: string;
          subtitle?: string | null;
          category?: string;
          read?: boolean;
          event_id?: string | null;
          entity_id?: string | null;
          metadata?: Record<string, any>;
        };
      };
      briefings: {
        Row: {
          id: string;
          user_id: string;
          type: 'morning' | 'evening';
          title: string;
          description: string | null;
          status: 'PENDING' | 'PROCESSING' | 'READY' | 'SENT' | 'FAILED';
          scheduled_for: string;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'morning' | 'evening';
          title: string;
          description?: string | null;
          status?: 'PENDING' | 'PROCESSING' | 'READY' | 'SENT' | 'FAILED';
          scheduled_for?: string;
          sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          description?: string | null;
          status?: 'PENDING' | 'PROCESSING' | 'READY' | 'SENT' | 'FAILED';
          scheduled_for?: string;
          sent_at?: string | null;
          updated_at?: string;
        };
      };
      briefing_items: {
        Row: {
          id: string;
          briefing_id: string;
          event_id: string;
          order_index: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          briefing_id: string;
          event_id: string;
          order_index?: number;
          created_at?: string;
        };
        Update: {
          order_index?: number;
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

