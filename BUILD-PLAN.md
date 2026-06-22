# My fam — Build Plan (ส่งต่อให้ Claude Code)

เอกสารนี้คือสเปกสำหรับให้ Claude Code ทำงานในโปรเจกต์ `my-fam` ที่มีอยู่แล้ว
ทำ **ทีละ task ตามลำดับ** และ **commit แยกแต่ละ task** เทสต์ด้วย `npm run dev` ก่อน commit ทุกครั้ง

---

## 0. Context & Conventions (อ่านก่อนเริ่ม)

**Stack:** Vite + React 18 + `@supabase/supabase-js`
**โครงไฟล์หลัก:**
- `src/App.jsx` — ทั้งแอปอยู่ไฟล์เดียว (constants + components + CSS template string ชื่อ `CSS`)
- `src/lib/supabase.js` — มี `getJSON(key)` / `setJSON(key, val)` + supabase client
- `sql/setup.sql` — schema ของ Supabase

**ที่เก็บข้อมูล:** Supabase table `app_data (key text PK, value jsonb, updated_at timestamptz)`
อ่าน/เขียนผ่าน `getJSON` / `setJSON` เท่านั้น (เก็บเป็น JSON ทั้งก้อนต่อ key)
keys ปัจจุบัน: `fh:v1:restaurants`, `fh:v1:laundry`
**key ใหม่ที่จะเพิ่ม:** `fh:v1:benefits`

**Conventions ที่ต้องคงไว้ (สำคัญ):**
- Tunable constants block อยู่บนสุดของ `App.jsx` — ของใหม่ให้เพิ่มในบล็อกนี้
- Realtime: subscribe `postgres_changes` บน table `app_data` แล้ว dedup ด้วย ref (เทียบ JSON string) — ทำ pattern เดียวกันกับ key ใหม่
- Mutation ใช้ read-modify-write: `const cur = (await getJSON(key)) ?? state; const next = ...; setState(next); ref.current = JSON.stringify(next); await setJSON(key, next)`
- UI ภาษาไทย, mobile-first, ห้ามใช้ localStorage/sessionStorage
- Design tokens (ใน `CSS`): `--paper #FAF6F0`, `--ink #2C2620`, `--orange #F07C36`, `--mint #1FB892`, fonts: Mali (หัวข้อ) / IBM Plex Sans Thai (เนื้อหา) / IBM Plex Mono (ตัวเลข/วันที่)
- มี util พร้อมใช้: `ymd(date)`, `calCells(y,m)`, `thaiShortDate(key)`, `TH_MONTH`, `TH_MONTH_SHORT`, `DOW`, `beYear(y)`
- มี component พร้อมใช้: `Stamp`, `MonthCalendar`, `MiniMonth`
- ปุ่ม = `<button>` จริง, ห้ามใช้ `<form>`

---

## TASK 1 — เพิ่มช่องโน้ตในร้านอาหาร

**เป้าหมาย:** เพิ่ม note สั้น ๆ ต่อร้าน (optional)

- เพิ่ม field `note` (string, optional) ใน restaurant object
- ใน `RestaurantForm` เพิ่มช่อง "โน้ต (ไม่บังคับ)" เป็น `<input>` บรรทัดเดียว ต่อจากช่องราคาน้ำเปล่า
- ใน `RestaurantCard` ถ้ามี `note` แสดงเป็น **บรรทัดเดียว ตัดท้ายด้วย …** (CSS: `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`) สีจาง (`--ink-soft`) แตะที่โน้ตเพื่อสลับ ขยาย/ย่อ ได้
- เก็บ/แก้ไขผ่าน flow เดิม (ไม่ต้องแตะ schema เพราะเก็บเป็น JSON อยู่แล้ว)

**Acceptance:** เพิ่ม/แก้โน้ตได้, การ์ดไม่ยาวขึ้นเวลาโน้ตยาว (ตัดท้าย), กดขยายอ่านเต็มได้

---

## TASK 2 — ปุ่มสลับมุมมอง "การ์ดเต็ม / สรุปน้ำแข็ง"

**เป้าหมาย:** ลดความรกของลิสต์ ให้สแกนเรื่องน้ำแข็งได้ไว

- เพิ่ม state `viewMode: 'full' | 'ice'` (default `'full'`)
- เพิ่ม segmented toggle บนสุดของแท็บร้าน (เหนือช่องค้นหา หรือใต้ chips): **[ การ์ดเต็ม ] [ สรุปน้ำแข็ง ]** สไตล์เดียวกับ `.tabs`/`.seg`
- โหมด `ice` = ลิสต์ compact บรรทัดเดียวต่อร้าน:
  - เรียงตามชื่อร้าน A→Z ด้วย `localeCompare(b, 'th')`
  - แสดงแค่: ชื่อร้าน (ซ้าย) + badge น้ำแข็ง (ขวา): ฟรี (เขียวมิ้น) / `฿{glass}·฿{bucket}` (ส้ม, mono) / "ยังไม่ได้เช็ก" (เทา)
  - ไม่มีปุ่ม/โน้ต/น้ำเปล่า — เน้นสะอาด
  - ยังเคารพ search + filter chips เดิม
- โหมด `full` = การ์ดเดิม (มี TASK 1 แล้ว)

**Acceptance:** สลับสองมุมมองได้, โหมดสรุปเรียง A→Z ถูก, search/filter ใช้ได้ทั้งสองโหมด

---

## TASK 3 — ฟีเจอร์ใหม่: "สิทธิ์ & คูปอง" (เฟส 1: แบบครั้งเดียว)

**เป้าหมาย:** กันลืมใช้สิทธิ์/คูปองก่อนหมดอายุ

### 3.1 โครงสร้าง
- เพิ่มแท็บที่ 3 ในแถบ tabs: "สิทธิ์" (ใช้ไอคอน เช่น รูปตั๋ว/ของขวัญ) — ถ้าแถบแคบบนมือถือ ให้ย่อ label หรือทำให้ scroll แนวนอนได้
- key ใหม่ `fh:v1:benefits` (array) + state `benefits` + realtime subscription + mutation helper แบบเดียวกับ restaurants

### 3.2 Data model (benefit object) — ใส่ field เผื่อเฟส 2 ไว้เลย
```
{
  id, createdAt,
  title,        // ชื่อสิทธิ์ เช่น "Koi Thé ฿50" (required)
  store,        // ใช้ที่ร้าน เช่น "Koi Thé"
  source,       // ได้มาจาก เช่น "ธอส / GHB app", "uchoose", "BLA"
  value,        // มูลค่า: string อิสระ เช่น "50 บาท", "15%"
  owner,        // เจ้าของ: string (จาก quick-pick ม้า/น้าเม/เยลลี่/มิ้น หรือพิมพ์เอง)
  proof,        // หลักฐานที่ใช้รับสิทธิ์ เช่น "แคปหน้าจอ", "บัตรสมาชิก"
  note,         // โน้ตอิสระ
  kind,         // 'oneoff' | 'monthly'   (เฟส 1 ทำ 'oneoff')
  expiry,       // 'YYYY-MM-DD' วันสุดท้ายที่ใช้ได้ (oneoff: required)
  claimStart,   // 'YYYY-MM-DD' optional (ถ้าเป็นช่วงรับสิทธิ์)
  dayStart,     // 1-31 (monthly เฟส 2)
  dayEnd,       // 1-31 (monthly เฟส 2)
  done,         // boolean (oneoff: ใช้แล้ว)
  doneAt,       // ISO string optional
  doneMonths,   // string[] ['YYYY-MM'] (monthly เฟส 2)
}
```

### 3.3 UI (บนลงล่าง)
1. **แถบ "ใกล้หมด"** — แสดงสิทธิ์ที่ `kind==='oneoff' && !done && เหลือ ≤ 7 วัน` เรียงด่วนสุดก่อน ใช้สีเตือน (เช่น `--orange-wash`/แดงอ่อนถ้า ≤2 วัน) แต่ละอันโชว์ชื่อ + ร้าน + "เหลือ X วัน" ถ้าไม่มี ให้ซ่อนแถบ
2. **ปฏิทิน** — ทำ component ใหม่ `BenefitCalendar` (reuse `calCells` + style จาก `.calcard/.grid/.cell`):
   - วันที่มี due (expiry) แสดง marker: จุดสี + ตัวเลขจำนวนถ้า >1
   - สีของ marker: ≤2 วัน = แดง, ≤7 วัน = ส้ม, อื่น ๆ = เทา/หมึก; วันนี้ = ring
   - เลื่อนเดือนได้ (เดือนปัจจุบัน + ล่วงหน้า) แบบเดียวกับหน้าตากผ้า
   - แตะวัน → set `selectedDay` แล้ว filter ลิสต์ด้านล่างเป็นเฉพาะวันนั้น + มีปุ่ม "ดูทั้งหมด" เคลียร์ filter
3. **ลิสต์สิทธิ์ทั้งหมด** — เรียงตาม "เหลือกี่วัน" (น้อย→มาก); ของที่ `done` หรือเลย expiry ไปแล้ว ยุบไว้ section ล่าง "ใช้แล้ว / หมดอายุ" (collapsible)
   - แต่ละการ์ด: ชื่อสิทธิ์ (เด่น) + chips เล็ก (ร้าน, มูลค่า, เจ้าของ) + "หมด {thaiShortDate} · เหลือ X วัน" + ปุ่ม **"ใช้แล้ว"** (toggle `done`)
   - แตะการ์ด → ขยายดูรายละเอียด: ได้มาจาก, หลักฐานที่ใช้, โน้ต
4. **ฟอร์มเพิ่ม/แก้สิทธิ์** (`BenefitForm`):
   - title (required), store, source, value, owner (quick-pick chips: ม้า/น้าเม/เยลลี่/มิ้น + พิมพ์เอง), proof, note
   - kind: เฟส 1 fix เป็น `'oneoff'` (ปุ่มเลือกประเภทเตรียม UI ไว้แต่ disable 'monthly' ก่อน หรือซ่อน)
   - expiry: date input (required), claimStart: date optional
   - validation: ต้องมี title + expiry

### 3.4 Logic
- `daysLeft(b)` = จำนวนวันจาก today ถึง `expiry` (อิง local date, ปัดเป็นวัน)
- เรียง/กรอง/แถบใกล้หมด คำนวณจาก `daysLeft` และ `done`
- ใช้ `ymd`/date utils ที่มีอยู่

**Acceptance:** เพิ่ม/แก้/ลบสิทธิ์ได้; แถบใกล้หมดโชว์ถูก; ปฏิทินมี marker ตรงวัน, กดวันแล้ว filter ลิสต์; กด "ใช้แล้ว" ย้ายลงล่าง; sync realtime ข้ามเครื่อง

---

## TASK 4 — สิทธิ์เฟส 2: แบบรายเดือน (recurring monthly)

ทำหลัง TASK 3 ใช้งานนิ่งแล้ว

- เปิดให้เลือก `kind: 'monthly'` ในฟอร์ม + ช่อง `dayStart`–`dayEnd` (วันของเดือน เช่น รับได้วันที่ 1–5)
- ปฏิทิน: monthly แสดง marker ที่ `dayEnd` ของเดือนที่กำลังดู (เส้นตายรับสิทธิ์เดือนนั้น) หรือไฮไลต์ช่วง `dayStart`–`dayEnd`
- สถานะ "เดือนนี้รับแล้ว" เก็บใน `doneMonths` (push `'YYYY-MM'` ของเดือนปัจจุบัน) — ปุ่ม "รับแล้วเดือนนี้"
- Logic ใกล้หมด: monthly ที่ยังไม่ `doneMonths.includes(เดือนนี้)` และวันนี้ ≤ `dayEnd` → นับ "เหลือ X วัน" ถึง `dayEnd`; ถ้าเลย → "พลาดเดือนนี้" แล้วรีเซ็ตเดือนถัดไป

**Acceptance:** สิทธิ์รายเดือนโผล่ทุกเดือนใหม่อัตโนมัติ; กด "รับแล้วเดือนนี้" แล้วเงียบจนเดือนหน้า

---

## TASK 5 — แจ้งเตือน (โรดแมป — ยังไม่ต้องทำตอนนี้)

ทำตามลำดับเมื่อพร้อม:

**5.1 ในแอป (ทำง่าย แนะนำทำก่อน)**
- ตอนเปิดแอป ถ้ามีสิทธิ์ใกล้หมด ≤7 วัน โชว์แบนเนอร์สรุป "มี N สิทธิ์ใกล้หมดใน 7 วัน" + ลิงก์ไปแท็บสิทธิ์ (ใช้ข้อมูลที่มีอยู่ ไม่ต้องมี backend)

**5.2 LINE bot (เข้ากับนิสัยเดิมที่ปักหมุดในกลุ่ม)**
- ใช้ **LINE Messaging API** (ไม่ใช่ LINE Notify ซึ่งปิดบริการแล้ว — ตอนทำให้เช็กตัวเลือกล่าสุดของ LINE อีกครั้ง)
- สถาปัตยกรรม: scheduled job รันวันละครั้ง → query สิทธิ์ใกล้หมด → push เข้ากลุ่มครอบครัว
  - ทางเลือก A: **Vercel Cron** เรียก serverless function (`/api/notify`) → อ่าน Supabase → เรียก LINE push API
  - ทางเลือก B: **Supabase Edge Function + pg_cron** ทำทั้งหมดใน Supabase
- ต้องเตรียม: LINE Official Account + Messaging API channel (ฟรี), channel access token (เก็บเป็น secret/env), เพิ่มบอทเข้ากลุ่มครอบครัวเพื่อเอา groupId
- ข้อความ push: รายการสิทธิ์ที่จะหมดใน X วัน + ร้าน + มูลค่า

**5.3 Web Push (PWA) — ทางเลือกท้าย ๆ**
- ต้องมี service worker + VAPID keys + backend ส่ง push; iOS รองรับเฉพาะ PWA ที่ติดตั้งหน้าโฮม (iOS 16.4+)

---

## หมายเหตุการทำงาน
- commit ทีละ task: `task1: restaurant note`, `task2: ice summary view`, `task3: benefits feature (one-off)`, ฯลฯ
- เทสต์ใน `npm run dev` ก่อน commit; push แล้ว Vercel auto-deploy → เทสต์บนมือถือจริง
- ถ้าเพิ่ม dependency ใหม่ให้ระบุเหตุผล; พยายามไม่เพิ่มถ้าไม่จำเป็น
- ไม่ต้องแก้ `sql/setup.sql` (ใช้ table `app_data` เดิม) เว้นแต่จะเปลี่ยนสถาปัตยกรรม

## การตัดสินใจ (ยืนยันแล้ว — ใช้ค่านี้)
1. เจ้าของสิทธิ์ = quick-pick chips **ม้า / น้าเม / เยลลี่ / มิ้น** + พิมพ์เพิ่มเองได้
2. มูลค่า = พิมพ์อิสระ (string เช่น "50 บาท", "15%")
3. ปฏิทินสิทธิ์ = เดือนปัจจุบัน + เลื่อนดูล่วงหน้าได้ (แบบหน้าตากผ้า)
