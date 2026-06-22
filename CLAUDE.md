# CLAUDE.md — My fam

คู่มือ context สำหรับ Claude Code (อ่านไฟล์นี้ก่อนเริ่มทุก session)

## โปรเจกต์
"My fam" — เว็บแอปครอบครัว (ภาษาไทย, mobile-first) ปัจจุบันมี 2 แท็บ:
- **ร้านอาหาร**: จดร้าน + สถานะน้ำแข็ง (ฟรี / แก้วละ / ถังละ) + ราคาน้ำเปล่า, ค้นหา/กรองได้
- **เวรตากผ้า**: ปฏิทินหมุนเวร เยลลี่ (หัวใจสีส้ม) / มิ้น (ดาวสีเขียวมิ้นต์)

## Stack
Vite + React 18 + @supabase/supabase-js · deploy บน Vercel (auto-deploy จาก branch `main`)

## โครงไฟล์
- `src/App.jsx` — ทั้งแอปอยู่ไฟล์เดียว (constants + components + CSS template string ชื่อ `CSS`)
- `src/lib/supabase.js` — supabase client + `getJSON(key)` / `setJSON(key, val)`
- `sql/setup.sql` — schema ของ Supabase
- `public/` — ไอคอน / favicon / manifest

## ที่เก็บข้อมูล
Supabase table `app_data (key text PK, value jsonb, updated_at timestamptz)`
อ่าน/เขียนผ่าน `getJSON` / `setJSON` เท่านั้น (เก็บ JSON ทั้งก้อนต่อ 1 key)
keys ปัจจุบัน: `fh:v1:restaurants`, `fh:v1:laundry` (จะเพิ่ม `fh:v1:benefits`)

## Conventions (ต้องทำตาม)
- Tunable constants อยู่บนสุดของ `App.jsx` — ของใหม่ให้เพิ่มในบล็อกนี้
- Realtime: subscribe `postgres_changes` บน `app_data` แล้ว dedup ด้วย ref (เทียบ JSON string)
- Mutation = read-modify-write: `cur = (await getJSON(key)) ?? state` → สร้าง `next` → `setState(next)` + อัปเดต ref → `await setJSON(key, next)`
- UI ภาษาไทย, mobile-first, **ห้ามใช้ localStorage/sessionStorage**, ปุ่มใช้ `<button>` จริง (ห้าม `<form>`)
- Design tokens (ใน `CSS`): `--paper #FAF6F0`, `--ink #2C2620`, `--orange #F07C36` (เยลลี่), `--mint #1FB892` (มิ้น)
- Fonts: Mali (หัวข้อ) / IBM Plex Sans Thai (เนื้อหา) / IBM Plex Mono (ตัวเลข/วันที่)
- Utils พร้อมใช้: `ymd`, `calCells`, `thaiShortDate`, `TH_MONTH`, `TH_MONTH_SHORT`, `DOW`, `beYear`
- Components พร้อมใช้: `Stamp`, `MonthCalendar`, `MiniMonth`

## Workflow
- งานทั้งหมดดูใน `BUILD-PLAN.md` — ทำทีละ Task ตามลำดับ
- เทสต์ด้วย `npm run dev` ก่อน commit; commit แยกต่อ Task; push → Vercel auto-deploy
- ไม่เพิ่ม dependency ถ้าไม่จำเป็น; ไม่แก้ `sql/setup.sql` เว้นแต่จะเปลี่ยนสถาปัตยกรรม
