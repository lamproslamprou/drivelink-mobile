import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ykzovtfwcjkaigwznrsi.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlrem92dGZ3Y2prYWlnd3pucnNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2Nzc3ODMsImV4cCI6MjA5ODI1Mzc4M30.LprBsIabOD2xwXUgHoNeGQY9uHNNYKKfneNWKfY06WY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
