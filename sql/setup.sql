-- =================================================================
-- My fam — Supabase setup
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วาง SQL นี้ → Run
-- =================================================================

-- 1. สร้าง table เก็บข้อมูลแบบ key-value
CREATE TABLE IF NOT EXISTS app_data (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. เปิด Row Level Security
ALTER TABLE app_data ENABLE ROW LEVEL SECURITY;

-- 3. อนุญาตให้ทุกคน read/write ได้ (แอปครอบครัว ไม่ต้อง login)
CREATE POLICY "allow_all" ON app_data
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. เปิด Realtime (sync ทุกคนทันที ไม่ต้อง poll)
ALTER PUBLICATION supabase_realtime ADD TABLE app_data;

-- เสร็จแล้ว! ตรวจดูว่า table "app_data" ขึ้นใน Table Editor
