# My fam — คู่มือติดตั้งและ deploy

ทำตามขั้นตอนข้างล่างนี้ตามลำดับ ใช้เวลาประมาณ 15–20 นาทีครับ

---

## ขั้นตอนที่ 1 — ตั้งค่า Supabase (database)

1. เปิด [supabase.com](https://supabase.com) แล้ว login
2. กด **New project** → ตั้งชื่อว่า `my-fam` → เลือก region ที่ใกล้ที่สุด (แนะนำ `Singapore`) → ตั้ง Database Password (จดไว้) → กด **Create new project**
3. รอสักครู่จนโปรเจกต์สร้างเสร็จ
4. ไปที่เมนู **SQL Editor** (แถบซ้าย)
5. คลิก **New query** → วางเนื้อหาจากไฟล์ `sql/setup.sql` → กด **Run**
6. ตรวจสอบว่า table `app_data` ขึ้นใน **Table Editor**
7. ไปที่ **Settings → API** แล้วคัดลอกค่าสองอย่างนี้ไว้:
   - **Project URL** (ขึ้นต้นด้วย `https://`)
   - **anon public** key (ใต้ Project API keys)

---

## ขั้นตอนที่ 2 — เซ็ตอัปไฟล์ในเครื่อง

```bash
# แตก zip แล้วเข้าโฟลเดอร์
cd my-fam

# คัดลอกไฟล์ตัวอย่าง .env
cp .env.example .env
```

เปิดไฟล์ `.env` แล้วแก้ให้ตรงกับค่าจาก Supabase:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

จากนั้นติดตั้ง dependencies และทดสอบในเครื่อง:

```bash
npm install
npm run dev
```

เปิด [http://localhost:5173](http://localhost:5173) → ทดสอบเพิ่มร้านและกดเช็กอินตากผ้า ถ้าทำงานได้ → ไปขั้นตอนถัดไป

---

## ขั้นตอนที่ 3 — อัปโหลดขึ้น GitHub

```bash
# สร้าง repo ใหม่ใน GitHub (ชื่อ my-fam, Private หรือ Public ก็ได้)
# แล้วรันคำสั่งข้างล่างในโฟลเดอร์โปรเจกต์:

git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/my-fam.git
git push -u origin main
```

---

## ขั้นตอนที่ 4 — Deploy บน Vercel

1. เปิด [vercel.com](https://vercel.com) → login
2. กด **Add New → Project** → เลือก repo `my-fam` ที่เพิ่ง push
3. Vercel จะตรวจจับว่าเป็น Vite project อัตโนมัติ → ไม่ต้องแก้ settings
4. ไปที่แท็บ **Environment Variables** → เพิ่ม 2 ค่านี้:
   - `VITE_SUPABASE_URL` → ใส่ค่าจาก Supabase
   - `VITE_SUPABASE_ANON_KEY` → ใส่ค่าจาก Supabase
5. กด **Deploy** → รอประมาณ 1-2 นาที
6. Vercel จะให้ URL เช่น `https://my-fam-xxx.vercel.app` → แชร์ให้ครอบครัวได้เลย!

---

## ขั้นตอนที่ 5 (ทางเลือก) — ผูก Custom Domain

ถ้ามี domain เอง เช่น `myfam.example.com`:
1. ใน Vercel → **Settings → Domains** → ใส่ domain
2. ทำตามขั้นตอน DNS ที่ Vercel แนะนำ

---

## ไอคอน (สำหรับ iPhone / Android)

ไฟล์ไอคอนทั้งหมดอยู่ในโฟลเดอร์ `public/` แล้ว — Vercel จะ serve ให้อัตโนมัติ

**เพิ่มไปหน้าโฮม iPhone:**
Safari → เปิด URL → ปุ่ม Share (กล่องลูกศรขึ้น) → **เพิ่มไปยังหน้าจอโฮม**

**Android:**
Chrome → เปิด URL → เมนู (สามจุด) → **เพิ่มลงในหน้าจอหลัก**

---

## แก้ไขชื่อ / สีทีหลัง

เปิดไฟล์ `src/App.jsx` → บริเวณบนสุดมี **Tunable constants** ปรับได้ทุกค่า:
- `APP_NAME` / `APP_SUB` — ชื่อแอป
- `PEOPLE` — ชื่อ สี สัญลักษณ์ของเยลลี่และมิ้น
- `ROTATION_START` — คิวเริ่มต้น

หลังแก้ไข → `git commit` → `git push` → Vercel จะ auto-deploy ให้เองครับ

---

## ปัญหาที่พบบ่อย

| อาการ | วิธีแก้ |
|-------|---------|
| แบนเนอร์เหลือง "ยังไม่ได้ตั้งค่า Supabase" | ตรวจสอบ `.env` ว่าใส่ค่าถูกต้อง และ `npm run dev` ใหม่ |
| บันทึกไม่สำเร็จ (แบนเนอร์แดง) | ตรวจ SQL setup ว่า policy ถูกสร้างแล้ว |
| ข้อมูลไม่ sync | ตรวจ SQL ว่ารัน `ALTER PUBLICATION supabase_realtime...` แล้ว |
| Vercel build fail | ตรวจ Environment Variables ว่าเพิ่มครบทั้งสองค่า |
