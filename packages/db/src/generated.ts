export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string
          created_by_email: string | null
          email: string
        }
        Insert: {
          created_at?: string
          created_by_email?: string | null
          email: string
        }
        Update: {
          created_at?: string
          created_by_email?: string | null
          email?: string
        }
        Relationships: []
      }
      canvas_assignment_cache: {
        Row: {
          canvas_assignment_id: string
          canvas_course_id: string
          last_synced_at: string
          payload: Json
          teacher_id: string
        }
        Insert: {
          canvas_assignment_id: string
          canvas_course_id: string
          last_synced_at?: string
          payload: Json
          teacher_id: string
        }
        Update: {
          canvas_assignment_id?: string
          canvas_course_id?: string
          last_synced_at?: string
          payload?: Json
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_assignment_cache_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      canvas_course_cache: {
        Row: {
          canvas_course_id: string
          last_synced_at: string
          payload: Json
          teacher_id: string
        }
        Insert: {
          canvas_course_id: string
          last_synced_at?: string
          payload: Json
          teacher_id: string
        }
        Update: {
          canvas_course_id?: string
          last_synced_at?: string
          payload?: Json
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canvas_course_cache_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      card_text_defaults: {
        Row: {
          body: string
          cta_label: string
          footnote: string
          id: number
          kicker: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          cta_label?: string
          footnote?: string
          id: number
          kicker?: string
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          cta_label?: string
          footnote?: string
          id?: number
          kicker?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      course_install_policies: {
        Row: {
          auto_install_new_assignments: boolean
          canvas_course_id: string
          created_at: string
          default_exam_template_id: string | null
          teacher_id: string
          updated_at: string
        }
        Insert: {
          auto_install_new_assignments?: boolean
          canvas_course_id: string
          created_at?: string
          default_exam_template_id?: string | null
          teacher_id: string
          updated_at?: string
        }
        Update: {
          auto_install_new_assignments?: boolean
          canvas_course_id?: string
          created_at?: string
          default_exam_template_id?: string | null
          teacher_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_install_policies_default_exam_template_id_fkey"
            columns: ["default_exam_template_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_install_policies_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      course_rosters: {
        Row: {
          canvas_course_id: string
          last_synced_at: string
          students: Json
          teacher_id: string
        }
        Insert: {
          canvas_course_id: string
          last_synced_at?: string
          students?: Json
          teacher_id: string
        }
        Update: {
          canvas_course_id?: string
          last_synced_at?: string
          students?: Json
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_rosters_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_sessions: {
        Row: {
          audio_url: string | null
          call_duration_sec: number | null
          canvas_assignment_id: string
          canvas_draft_comment_id: string | null
          canvas_submission_id: string | null
          completed_at: string | null
          created_at: string
          eval_error: string | null
          eval_prompt_body_snapshot: string | null
          eval_text: string | null
          exam_template_id: string | null
          excluded_reason: string | null
          id: string
          live_minutes_used: number
          persona_name_snapshot: string | null
          personality_preset_id: string | null
          roster_snapshot: Json | null
          rubric_body_snapshot: string | null
          scrub_status: string
          selected_questions: Json | null
          state: Database["public"]["Enums"]["exam_session_state"]
          student_id: string
          student_summary: string | null
          super_grader_post_status: Database["public"]["Enums"]["super_grader_post_status"]
          super_grader_response: Json | null
          transcript: Json | null
        }
        Insert: {
          audio_url?: string | null
          call_duration_sec?: number | null
          canvas_assignment_id: string
          canvas_draft_comment_id?: string | null
          canvas_submission_id?: string | null
          completed_at?: string | null
          created_at?: string
          eval_error?: string | null
          eval_prompt_body_snapshot?: string | null
          eval_text?: string | null
          exam_template_id?: string | null
          excluded_reason?: string | null
          id?: string
          live_minutes_used?: number
          persona_name_snapshot?: string | null
          personality_preset_id?: string | null
          roster_snapshot?: Json | null
          rubric_body_snapshot?: string | null
          scrub_status?: string
          selected_questions?: Json | null
          state?: Database["public"]["Enums"]["exam_session_state"]
          student_id: string
          student_summary?: string | null
          super_grader_post_status?: Database["public"]["Enums"]["super_grader_post_status"]
          super_grader_response?: Json | null
          transcript?: Json | null
        }
        Update: {
          audio_url?: string | null
          call_duration_sec?: number | null
          canvas_assignment_id?: string
          canvas_draft_comment_id?: string | null
          canvas_submission_id?: string | null
          completed_at?: string | null
          created_at?: string
          eval_error?: string | null
          eval_prompt_body_snapshot?: string | null
          eval_text?: string | null
          exam_template_id?: string | null
          excluded_reason?: string | null
          id?: string
          live_minutes_used?: number
          persona_name_snapshot?: string | null
          personality_preset_id?: string | null
          roster_snapshot?: Json | null
          rubric_body_snapshot?: string | null
          scrub_status?: string
          selected_questions?: Json | null
          state?: Database["public"]["Enums"]["exam_session_state"]
          student_id?: string
          student_summary?: string | null
          super_grader_post_status?: Database["public"]["Enums"]["super_grader_post_status"]
          super_grader_response?: Json | null
          transcript?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_sessions_exam_template_id_fkey"
            columns: ["exam_template_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_sessions_personality_preset_id_fkey"
            columns: ["personality_preset_id"]
            isOneToOne: false
            referencedRelation: "personality_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_sessions_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_template_bindings: {
        Row: {
          bound_at: string
          canvas_assignment_id: string
          canvas_course_id: string
          exam_template_id: string | null
          exam_token: string
          personality_preset_id: string | null
          post_to_canvas_comment: boolean
          post_to_canvas_submission: boolean
          post_to_drive: boolean
          teacher_id: string
        }
        Insert: {
          bound_at?: string
          canvas_assignment_id: string
          canvas_course_id: string
          exam_template_id?: string | null
          exam_token: string
          personality_preset_id?: string | null
          post_to_canvas_comment?: boolean
          post_to_canvas_submission?: boolean
          post_to_drive?: boolean
          teacher_id: string
        }
        Update: {
          bound_at?: string
          canvas_assignment_id?: string
          canvas_course_id?: string
          exam_template_id?: string | null
          exam_token?: string
          personality_preset_id?: string | null
          post_to_canvas_comment?: boolean
          post_to_canvas_submission?: boolean
          post_to_drive?: boolean
          teacher_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_template_bindings_exam_template_id_fkey"
            columns: ["exam_template_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_template_bindings_personality_preset_id_fkey"
            columns: ["personality_preset_id"]
            isOneToOne: false
            referencedRelation: "personality_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_template_bindings_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_templates: {
        Row: {
          archived_at: string | null
          closing_text: string | null
          created_at: string
          duration_max_sec: number
          duration_min_sec: number
          eval_prompt_body: string | null
          flow_body: string | null
          follow_up_depth: string | null
          id: string
          intake_config: Json
          live_voice_name: string | null
          locked_at: string | null
          name: string
          opening_text: string | null
          parent_template_id: string | null
          persona_body: string | null
          personality_preset_id: string | null
          personalization_enabled: boolean | null
          question_bank: Json
          question_set_id: string | null
          reference_texts: Json
          rubric_body: string | null
          rubric_version: string
          teacher_id: string
          topic_context: string | null
          updated_at: string
          version_number: number
        }
        Insert: {
          archived_at?: string | null
          closing_text?: string | null
          created_at?: string
          duration_max_sec?: number
          duration_min_sec?: number
          eval_prompt_body?: string | null
          flow_body?: string | null
          follow_up_depth?: string | null
          id?: string
          intake_config?: Json
          live_voice_name?: string | null
          locked_at?: string | null
          name: string
          opening_text?: string | null
          parent_template_id?: string | null
          persona_body?: string | null
          personality_preset_id?: string | null
          personalization_enabled?: boolean | null
          question_bank?: Json
          question_set_id?: string | null
          reference_texts?: Json
          rubric_body?: string | null
          rubric_version?: string
          teacher_id: string
          topic_context?: string | null
          updated_at?: string
          version_number?: number
        }
        Update: {
          archived_at?: string | null
          closing_text?: string | null
          created_at?: string
          duration_max_sec?: number
          duration_min_sec?: number
          eval_prompt_body?: string | null
          flow_body?: string | null
          follow_up_depth?: string | null
          id?: string
          intake_config?: Json
          live_voice_name?: string | null
          locked_at?: string | null
          name?: string
          opening_text?: string | null
          parent_template_id?: string | null
          persona_body?: string | null
          personality_preset_id?: string | null
          personalization_enabled?: boolean | null
          question_bank?: Json
          question_set_id?: string | null
          reference_texts?: Json
          rubric_body?: string | null
          rubric_version?: string
          teacher_id?: string
          topic_context?: string | null
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_templates_parent_template_id_fkey"
            columns: ["parent_template_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_templates_personality_preset_id_fkey"
            columns: ["personality_preset_id"]
            isOneToOne: false
            referencedRelation: "personality_presets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_templates_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_templates_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      gemini_usage_daily: {
        Row: {
          date: string
          denials: number
          live_minutes: number
          teacher_id: string
          text_calls: number
          updated_at: string
        }
        Insert: {
          date?: string
          denials?: number
          live_minutes?: number
          teacher_id: string
          text_calls?: number
          updated_at?: string
        }
        Update: {
          date?: string
          denials?: number
          live_minutes?: number
          teacher_id?: string
          text_calls?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gemini_usage_daily_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      personality_presets: {
        Row: {
          closing_text: string | null
          created_at: string
          default_question_set_id: string | null
          description: string | null
          eval_prompt_body: string | null
          flow_body: string
          follow_up_depth: string
          id: string
          intake_config: Json
          live_voice_name: string | null
          name: string
          opening_text: string | null
          persona_body: string
          personalization_enabled: boolean
          rubric_body: string | null
          teacher_id: string | null
          updated_at: string
        }
        Insert: {
          closing_text?: string | null
          created_at?: string
          default_question_set_id?: string | null
          description?: string | null
          eval_prompt_body?: string | null
          flow_body: string
          follow_up_depth?: string
          id?: string
          intake_config?: Json
          live_voice_name?: string | null
          name: string
          opening_text?: string | null
          persona_body: string
          personalization_enabled?: boolean
          rubric_body?: string | null
          teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          closing_text?: string | null
          created_at?: string
          default_question_set_id?: string | null
          description?: string | null
          eval_prompt_body?: string | null
          flow_body?: string
          follow_up_depth?: string
          id?: string
          intake_config?: Json
          live_voice_name?: string | null
          name?: string
          opening_text?: string | null
          persona_body?: string
          personalization_enabled?: boolean
          rubric_body?: string | null
          teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "personality_presets_default_question_set_id_fkey"
            columns: ["default_question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personality_presets_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          body: string
          id: string
          key: string
          purpose: Database["public"]["Enums"]["prompt_purpose"]
          scope: Database["public"]["Enums"]["prompt_scope"]
          updated_at: string
          updated_by_email: string | null
          version: number
        }
        Insert: {
          body: string
          id?: string
          key: string
          purpose: Database["public"]["Enums"]["prompt_purpose"]
          scope: Database["public"]["Enums"]["prompt_scope"]
          updated_at?: string
          updated_by_email?: string | null
          version?: number
        }
        Update: {
          body?: string
          id?: string
          key?: string
          purpose?: Database["public"]["Enums"]["prompt_purpose"]
          scope?: Database["public"]["Enums"]["prompt_scope"]
          updated_at?: string
          updated_by_email?: string | null
          version?: number
        }
        Relationships: []
      }
      question_buckets: {
        Row: {
          created_at: string
          id: string
          name: string
          position: number
          question_set_id: string
          select_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          position: number
          question_set_id: string
          select_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          position?: number
          question_set_id?: string
          select_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_buckets_question_set_id_fkey"
            columns: ["question_set_id"]
            isOneToOne: false
            referencedRelation: "question_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      question_sets: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          teacher_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          teacher_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          teacher_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_sets_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          created_at: string
          id: string
          position: number
          question_bucket_id: string
          reference_snippet: string | null
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          position: number
          question_bucket_id: string
          reference_snippet?: string | null
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          question_bucket_id?: string
          reference_snippet?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_question_bucket_id_fkey"
            columns: ["question_bucket_id"]
            isOneToOne: false
            referencedRelation: "question_buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_envelope: {
        Row: {
          body: string
          id: number
          updated_at: string
          updated_by_email: string | null
        }
        Insert: {
          body: string
          id?: number
          updated_at?: string
          updated_by_email?: string | null
        }
        Update: {
          body?: string
          id?: number
          updated_at?: string
          updated_by_email?: string | null
        }
        Relationships: []
      }
      students: {
        Row: {
          anon_token: string
          auth_user_id: string | null
          canvas_user_id: string
          created_at: string
          display_name: string
          email: string
          id: string
        }
        Insert: {
          anon_token: string
          auth_user_id?: string | null
          canvas_user_id: string
          created_at?: string
          display_name: string
          email: string
          id?: string
        }
        Update: {
          anon_token?: string
          auth_user_id?: string | null
          canvas_user_id?: string
          created_at?: string
          display_name?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      submission_attempts: {
        Row: {
          canvas_response: Json | null
          created_at: string
          error_message: string | null
          exam_session_id: string
          id: string
          kind: Database["public"]["Enums"]["submission_attempt_kind"]
          success: boolean
        }
        Insert: {
          canvas_response?: Json | null
          created_at?: string
          error_message?: string | null
          exam_session_id: string
          id?: string
          kind: Database["public"]["Enums"]["submission_attempt_kind"]
          success: boolean
        }
        Update: {
          canvas_response?: Json | null
          created_at?: string
          error_message?: string | null
          exam_session_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["submission_attempt_kind"]
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "submission_attempts_exam_session_id_fkey"
            columns: ["exam_session_id"]
            isOneToOne: false
            referencedRelation: "exam_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      teachers: {
        Row: {
          auth_user_id: string
          canvas_host: string | null
          canvas_token_encrypted: string | null
          card_body: string | null
          card_cta_label: string | null
          card_footnote: string | null
          card_kicker: string | null
          card_title: string | null
          created_at: string
          display_name: string
          email: string
          gemini_live_daily_cap_minutes: number | null
          gemini_live_dryrun_daily_cap_minutes: number | null
          gemini_text_daily_cap: number | null
          google_access_token: string | null
          google_oauth_tokens: Json | null
          google_refresh_token: string | null
          google_sub: string
          google_token_expires_at: string | null
          id: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          canvas_host?: string | null
          canvas_token_encrypted?: string | null
          card_body?: string | null
          card_cta_label?: string | null
          card_footnote?: string | null
          card_kicker?: string | null
          card_title?: string | null
          created_at?: string
          display_name: string
          email: string
          gemini_live_daily_cap_minutes?: number | null
          gemini_live_dryrun_daily_cap_minutes?: number | null
          gemini_text_daily_cap?: number | null
          google_access_token?: string | null
          google_oauth_tokens?: Json | null
          google_refresh_token?: string | null
          google_sub: string
          google_token_expires_at?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          canvas_host?: string | null
          canvas_token_encrypted?: string | null
          card_body?: string | null
          card_cta_label?: string | null
          card_footnote?: string | null
          card_kicker?: string | null
          card_title?: string | null
          created_at?: string
          display_name?: string
          email?: string
          gemini_live_daily_cap_minutes?: number | null
          gemini_live_dryrun_daily_cap_minutes?: number | null
          gemini_text_daily_cap?: number | null
          google_access_token?: string | null
          google_oauth_tokens?: Json | null
          google_refresh_token?: string | null
          google_sub?: string
          google_token_expires_at?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      begin_exam_session: {
        Args: {
          p_canvas_assignment_id: string
          p_selected_questions: Json
          p_student_id: string
        }
        Returns: {
          archived_prior_id: string
          classification: string
          session_id: string
        }[]
      }
      check_and_increment_gemini_live_minutes: {
        Args: {
          p_default_cap: number
          p_requested: number
          p_teacher_id: string
        }
        Returns: boolean
      }
      check_and_increment_gemini_text_calls: {
        Args: { p_default_cap: number; p_teacher_id: string }
        Returns: boolean
      }
      current_student_id: { Args: never; Returns: string }
      current_teacher_id: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      refund_gemini_live_minutes: {
        Args: { p_minutes: number; p_teacher_id: string }
        Returns: undefined
      }
      refund_gemini_live_minutes_session: {
        Args: { p_exam_session_id: string; p_minutes: number }
        Returns: undefined
      }
      teacher_owns_exam_template: { Args: { t_id: string }; Returns: boolean }
    }
    Enums: {
      exam_session_state:
        | "scheduled"
        | "started"
        | "in_progress"
        | "completed"
        | "excluded"
        | "failed"
      prompt_purpose:
        | "voice_agent"
        | "student_summary"
        | "eval_generation"
        | "rubric"
        | "transcription"
      prompt_scope: "system" | "template"
      submission_attempt_kind: "body" | "draft_eval" | "comment_fallback"
      super_grader_post_status: "pending" | "posted" | "error"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      exam_session_state: [
        "scheduled",
        "started",
        "in_progress",
        "completed",
        "excluded",
        "failed",
      ],
      prompt_purpose: [
        "voice_agent",
        "student_summary",
        "eval_generation",
        "rubric",
        "transcription",
      ],
      prompt_scope: ["system", "template"],
      submission_attempt_kind: ["body", "draft_eval", "comment_fallback"],
      super_grader_post_status: ["pending", "posted", "error"],
    },
  },
} as const
