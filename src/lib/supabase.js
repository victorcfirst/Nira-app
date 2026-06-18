import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[My fam] Missing Supabase credentials.\n' +
    'Copy .env.example → .env and fill in your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  )
}

export const supabase = createClient(supabaseUrl ?? '', supabaseKey ?? '')

/**
 * Read a JSON value from the app_data table.
 * Returns the parsed value or null if not found / error.
 */
export async function getJSON(key) {
  try {
    const { data, error } = await supabase
      .from('app_data')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (error) { console.error('[getJSON]', error); return null }
    return data?.value ?? null
  } catch (e) {
    console.error('[getJSON] exception', e)
    return null
  }
}

/**
 * Write (upsert) a JSON value to the app_data table.
 * Returns true on success, false on error.
 */
export async function setJSON(key, val) {
  try {
    const { error } = await supabase
      .from('app_data')
      .upsert(
        { key, value: val, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
    if (error) { console.error('[setJSON]', error); return false }
    return true
  } catch (e) {
    console.error('[setJSON] exception', e)
    return false
  }
}
