import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://tbybrpdrwngoqnjvfchq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IAjmiTFg8ekF0eDJo3tYiA_nYcCex7J';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);