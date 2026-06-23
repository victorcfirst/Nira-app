import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { supabase, getJSON, setJSON } from './lib/supabase'

/* =========================================================================
   My fam — family helper
   ฟีเจอร์: (1) จดร้าน + สถานะน้ำแข็ง  (2) เวรตากผ้า เยลลี่/มิ้น
   เก็บข้อมูลแบบ shared ผ่าน Supabase (realtime sync)
   ========================================================================= */

/* ---------- ปรับแต่งได้ที่นี่ (tunable constants) ---------- */
const STORAGE_VERSION = 'v1'
const APP_NAME = 'My fam'
const APP_SUB = 'เรื่องเล็ก ๆ ของบ้าน'

const K = {
  restaurants: `fh:${STORAGE_VERSION}:restaurants`,
  laundry:     `fh:${STORAGE_VERSION}:laundry`,
  benefits:    `fh:${STORAGE_VERSION}:benefits`,
}

// quick-pick เจ้าของสิทธิ์ (พิมพ์เพิ่มเองได้)
const OWNERS = ['ม้า', 'น้าเม', 'เยลลี่', 'มิ้น']
// แถบ "ใกล้หมด" + สีปฏิทิน: ≤ URGENT_DAYS วัน = แดง, ≤ SOON_DAYS วัน = ส้ม
const SOON_DAYS = 7
const URGENT_DAYS = 2

// สองพี่น้อง — เปลี่ยนชื่อ/สี/สัญลักษณ์ได้ตรงนี้
const PEOPLE = {
  jelly: { id: 'jelly', name: 'เยลลี่', shape: 'heart', color: '#F07C36' },
  mint:  { id: 'mint',  name: 'มิ้น',  shape: 'star',  color: '#1FB892' },
}
const ROTATION_START = 'jelly' // คิวเริ่มต้นถ้ายังไม่มีประวัติ

const ICE = {
  free:    'น้ำแข็งฟรี',
  paid:    'มีค่าใช้จ่าย',
  unknown: 'ยังไม่ได้เช็ก',
}
/* --------------------------------------------------------- */

const TH_MONTH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม']
const TH_MONTH_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']
const DOW = ['อา','จ','อ','พ','พฤ','ศ','ส']

const other   = (p) => (p === 'jelly' ? 'mint' : 'jelly')
const uid     = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const pad     = (n) => String(n).padStart(2, '0')
const ymd     = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addMons = (y, m, delta) => { const d = new Date(y, m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() } }
const beYear  = (y) => y + 543

function calCells(y, m) {
  const startDow = new Date(y, m, 1).getDay()
  const days = new Date(y, m + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(d)
  while (cells.length % 7) cells.push(null)
  return cells
}
function thaiShortDate(key) {
  const [y, m, d] = key.split('-').map(Number)
  return `${d} ${TH_MONTH_SHORT[m - 1]}`
}
// จำนวนวันจาก today ถึง dateKey ('YYYY-MM-DD') — อิง local date, ปัดเป็นวัน
function daysUntil(dateKey, todayKey) {
  if (!dateKey) return null
  const [ay, am, ad] = todayKey.split('-').map(Number)
  const [by, bm, bd] = dateKey.split('-').map(Number)
  const a = new Date(ay, am - 1, ad)
  const b = new Date(by, bm - 1, bd)
  return Math.round((b - a) / 86400000)
}
function daysLeftText(n) {
  if (n == null) return ''
  if (n < 0)  return `เลยมา ${-n} วัน`
  if (n === 0) return 'หมดวันนี้'
  if (n === 1) return 'เหลือ 1 วัน'
  return `เหลือ ${n} วัน`
}
function timeOf(iso) {
  try { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` } catch { return '' }
}
// จำนวนวันในเดือน (m = 0-11)
function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate() }
// clamp วันของเดือน (1..จำนวนวันในเดือน)
function clampDay(day, dim) { return Math.min(Math.max(day, 1), dim) }
// สถานะของสิทธิ์ (รองรับทั้ง oneoff และ monthly) อิงจาก today
function benStatus(b, todayKey) {
  if (b.kind === 'monthly') {
    const [ty, tm] = todayKey.split('-').map(Number) // tm = 1-12
    const ym  = `${ty}-${pad(tm)}`
    const dim = daysInMonth(ty, tm - 1)
    const dEnd = clampDay(b.dayEnd || dim, dim)
    const dueKey = ymd(new Date(ty, tm - 1, dEnd))
    const received = (b.doneMonths || []).includes(ym)
    const d = daysUntil(dueKey, todayKey)
    const missed = !received && d < 0
    return { monthly: true, ym, dStart: b.dayStart || 1, dEnd, dueKey, received, missed, d, settled: received || missed }
  }
  const d = daysUntil(b.expiry, todayKey)
  const expired = !b.done && d != null && d < 0
  return { monthly: false, d, received: !!b.done, missed: false, expired, settled: !!b.done || expired }
}
// dueKey ของ monthly สำหรับเดือนที่กำลังดู (y, m = 0-11)
function monthlyDueKey(b, y, m) {
  const dim = daysInMonth(y, m)
  return ymd(new Date(y, m, clampDay(b.dayEnd || dim, dim)))
}

/* ---------- small bits ---------- */
function Stamp({ shape, color, size = 24, rot = 0, pop = false }) {
  const style = { display: 'block', transform: `rotate(${rot}deg)`, transformOrigin: 'center' }
  const cls = 'stamp' + (pop ? ' pop' : '')
  if (shape === 'heart')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className={cls} style={style} aria-hidden="true">
        <path d="M12 21.6S2.4 15.3 2.4 8.6C2.4 5.4 4.9 3.2 7.7 3.2 9.6 3.2 11.2 4.2 12 5.7 12.8 4.2 14.4 3.2 16.3 3.2 19.1 3.2 21.6 5.4 21.6 8.6 21.6 15.3 12 21.6 12 21.6Z" fill={color}/>
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cls} style={style} aria-hidden="true">
      <path d="M12 2l2.95 6.13 6.55.78-4.84 4.5 1.28 6.59L12 17.6 5.06 20l1.28-6.59L1.5 9.41l6.55-.78L12 2z" fill={color}/>
    </svg>
  )
}
const dayRot = (d) => ((d * 37) % 11) - 5

const IconRest = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3v7a2 2 0 0 0 2 2M8 3v9M6 3v0M8 12v9M16 3c-1.4 0-2.4 2-2.4 5s1 4 2.4 4 2.4-1 2.4-4-1-5-2.4-5zM16 16v5"/>
  </svg>
)
const IconLaundry = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4a2 2 0 0 0-2 2c0 1 1 1.4 2 2l8 5c.7.4 1 .9 1 1.4 0 .8-.7 1.1-1.5 1.1H4.5C3.7 15.5 3 15.2 3 14.4c0-.5.3-1 1-1.4l8-5"/>
  </svg>
)
const IconTicket = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M13 6v12" strokeDasharray="2 2"/>
  </svg>
)
const IconCheck = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>
)
const IconEdit = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
)
const IconTrash = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m-9 0v14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6"/></svg>
)
const IconDrop = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>
)

/* ---------- calendars ---------- */
function MonthCalendar({ y, m, laundry, todayKey, onCellTap, justSet }) {
  const cells = calCells(y, m)
  return (
    <div className="grid">
      {cells.map((d, i) => {
        if (d == null) return <div key={i} className="cell empty" />
        const key = ymd(new Date(y, m, d))
        const p = laundry[key]?.person
        const cls = `cell${p ? ` has-${p}` : ''}${key === todayKey ? ' today' : ''}`
        return (
          <button key={i} className={cls} onClick={() => onCellTap(key)} aria-label={`วันที่ ${d}`}>
            <span className="dn">{d}</span>
            {p && <Stamp shape={PEOPLE[p].shape} color={PEOPLE[p].color} size={22} rot={dayRot(d)} pop={justSet === key} />}
          </button>
        )
      })}
    </div>
  )
}

function MiniMonth({ y, m, role, laundry }) {
  const cells = calCells(y, m)
  return (
    <div className="mini">
      <div className="mh">{role} · {TH_MONTH_SHORT[m]}</div>
      <div className="mdow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="mgrid">
        {cells.map((d, i) => {
          if (d == null) return <div key={i} className="mcell" />
          const key = ymd(new Date(y, m, d))
          const p = laundry[key]?.person
          return (
            <div key={i} className="mcell">
              <span className="mn">{d}</span>
              {p && <Stamp shape={PEOPLE[p].shape} color={PEOPLE[p].color} size={10} rot={dayRot(d)} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- restaurant form ---------- */
function RestaurantForm({ initial, onSave, onCancel }) {
  const [name,   setName]   = useState(initial?.name   || '')
  const [area,   setArea]   = useState(initial?.area   || '')
  const [ice,    setIce]    = useState(initial?.ice    || 'unknown')
  const [glass,  setGlass]  = useState(initial?.glass  != null ? String(initial.glass)  : '')
  const [bucket, setBucket] = useState(initial?.bucket != null ? String(initial.bucket) : '')
  const [water,  setWater]  = useState(initial?.water  != null ? String(initial.water)  : '')
  const [note,   setNote]   = useState(initial?.note   || '')
  const onlyNum = (v) => v.replace(/[^0-9.]/g, '')
  const canSave = name.trim().length > 0
  const submit = () => {
    if (!canSave) return
    const data = { name: name.trim(), area: area.trim(), ice }
    if (ice === 'paid') {
      data.glass  = glass.trim()  === '' ? null : Number(glass)
      data.bucket = bucket.trim() === '' ? null : Number(bucket)
    } else { data.glass = null; data.bucket = null }
    data.water = water.trim() === '' ? null : Number(water)
    data.note  = note.trim() === '' ? null : note.trim()
    onSave(data)
  }
  return (
    <div className="form">
      <div className="fld">
        <label>ชื่อร้าน</label>
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น ก๋วยเตี๋ยวป้าแดง" />
      </div>
      <div className="fld">
        <label>ตำแหน่ง / ย่าน <span className="opt">(ไม่ใส่ก็ได้)</span></label>
        <input className="inp" value={area} onChange={(e) => setArea(e.target.value)} placeholder="เช่น ตลาดนัดหน้าหมู่บ้าน" />
      </div>
      <div className="fld">
        <label>น้ำแข็ง</label>
        <div className="seg">
          {['free', 'paid', 'unknown'].map((k) => (
            <button key={k} className={ice === k ? 'on' : ''} onClick={() => setIce(k)}>{ICE[k]}</button>
          ))}
        </div>
        {ice === 'paid' && (
          <div className="prices">
            <div className="price"><span>แก้วละ ฿</span><input inputMode="numeric" value={glass}  onChange={(e) => setGlass(onlyNum(e.target.value))}  placeholder="–" /></div>
            <div className="price"><span>ถังละ ฿</span><input  inputMode="numeric" value={bucket} onChange={(e) => setBucket(onlyNum(e.target.value))} placeholder="–" /></div>
          </div>
        )}
      </div>
      <div className="fld">
        <label>ราคาน้ำเปล่า <span className="opt">(ไม่ใส่ก็ได้ · เก็บไว้ดูเฉย ๆ)</span></label>
        <div className="price"><span>฿</span><input inputMode="numeric" value={water} onChange={(e) => setWater(onlyNum(e.target.value))} placeholder="–" /></div>
      </div>
      <div className="fld">
        <label>โน้ต <span className="opt">(ไม่บังคับ)</span></label>
        <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ปิดวันจันทร์ / จอดรถยาก" />
      </div>
      <div className="formrow">
        <button className="btn primary" disabled={!canSave} onClick={submit}>{initial ? 'บันทึกการแก้ไข' : 'เพิ่มร้าน'}</button>
        <button className="btn ghost" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  )
}

/* ---------- restaurant card ---------- */
function iceContent(r) {
  if (r.ice === 'free') return <span className="badge free">{IconCheck} น้ำแข็งฟรี</span>
  if (r.ice === 'paid') {
    const segs = []
    if (r.glass  != null) segs.push(<span key="g">แก้วละ <span className="pm">฿{r.glass}</span></span>)
    if (r.bucket != null) segs.push(<span key="b">ถังละ <span className="pm">฿{r.bucket}</span></span>)
    const joined = segs.length
      ? segs.reduce((a, c, i) => (i ? [...a, <span key={'d'+i} className="mid"> · </span>, c] : [c]), [])
      : 'มีค่าใช้จ่าย'
    return <span className="badge paid">{joined}</span>
  }
  return <span className="badge unknown">ยังไม่ได้เช็ก</span>
}
/* ---------- ice summary row (compact view) ---------- */
function iceSummaryBadge(r) {
  if (r.ice === 'free') return <span className="ibadge free">ฟรี</span>
  if (r.ice === 'paid') {
    const segs = []
    if (r.glass  != null) segs.push(`฿${r.glass}`)
    if (r.bucket != null) segs.push(`฿${r.bucket}`)
    return <span className="ibadge paid">{segs.length ? segs.join('·') : 'มีค่าใช้จ่าย'}</span>
  }
  return <span className="ibadge unknown">ยังไม่ได้เช็ก</span>
}
function IceRow({ r }) {
  return (
    <div className="irow">
      <span className="iname">{r.name}</span>
      {iceSummaryBadge(r)}
    </div>
  )
}

function RestaurantCard({ r, onEdit, onAskDelete }) {
  const [noteOpen, setNoteOpen] = useState(false)
  return (
    <div className="rcard">
      <div className="rmain">
        <div className="rname">{r.name}</div>
        {r.area ? <div className="rarea">{r.area}</div> : null}
        <div className="badges">
          {iceContent(r)}
          {r.water != null && <span className="badge water">{IconDrop} น้ำเปล่า <span className="pm">฿{r.water}</span></span>}
        </div>
        {r.note ? (
          <div
            className={`rnote${noteOpen ? ' open' : ''}`}
            onClick={() => setNoteOpen((o) => !o)}
            title={noteOpen ? 'แตะเพื่อย่อ' : 'แตะเพื่อขยาย'}
          >
            {r.note}
          </div>
        ) : null}
      </div>
      <div className="ract">
        <button className="iconbtn" onClick={onEdit}       aria-label="แก้ไข">{IconEdit}</button>
        <button className="iconbtn" onClick={onAskDelete}  aria-label="ลบ">{IconTrash}</button>
      </div>
    </div>
  )
}

/* ---------- benefit calendar ---------- */
function dueLevel(n) {
  if (n == null) return 'gray'
  if (n <= URGENT_DAYS) return 'red'
  if (n <= SOON_DAYS)   return 'orange'
  return 'gray'
}
function BenefitCalendar({ y, m, dueMap, todayKey, selectedDay, onCellTap }) {
  const cells = calCells(y, m)
  return (
    <div className="grid">
      {cells.map((d, i) => {
        if (d == null) return <div key={i} className="cell empty" />
        const key  = ymd(new Date(y, m, d))
        const list = dueMap[key]
        const n    = list ? daysUntil(key, todayKey) : null
        const cls  = `cell${key === todayKey ? ' today' : ''}${key === selectedDay ? ' sel' : ''}`
        return (
          <button key={i} className={cls} onClick={() => onCellTap(key)} aria-label={`วันที่ ${d}`}>
            <span className="dn">{d}</span>
            {list && (
              <span className={`due due-${dueLevel(n)}`}>{list.length > 1 ? list.length : ''}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- benefit form ---------- */
function BenefitForm({ initial, onSave, onCancel }) {
  const [title,      setTitle]      = useState(initial?.title      || '')
  const [store,      setStore]      = useState(initial?.store      || '')
  const [source,     setSource]     = useState(initial?.source     || '')
  const [value,      setValue]      = useState(initial?.value      || '')
  const [owner,      setOwner]      = useState(initial?.owner      || '')
  const [proof,      setProof]      = useState(initial?.proof      || '')
  const [note,       setNote]       = useState(initial?.note       || '')
  const [kind,       setKind]       = useState(initial?.kind       || 'oneoff')
  const [expiry,     setExpiry]     = useState(initial?.expiry     || '')
  const [claimStart, setClaimStart] = useState(initial?.claimStart || '')
  const [dayStart,   setDayStart]   = useState(initial?.dayStart != null ? String(initial.dayStart) : '')
  const [dayEnd,     setDayEnd]     = useState(initial?.dayEnd   != null ? String(initial.dayEnd)   : '')
  const onlyDay = (v) => v.replace(/[^0-9]/g, '').slice(0, 2)
  const canSave = title.trim().length > 0 && (
    kind === 'monthly' ? Number(dayEnd) >= 1 && Number(dayEnd) <= 31 : expiry.trim().length > 0
  )
  const submit = () => {
    if (!canSave) return
    const base = {
      title:  title.trim(),
      store:  store.trim()  || null,
      source: source.trim() || null,
      value:  value.trim()  || null,
      owner:  owner.trim()  || null,
      proof:  proof.trim()  || null,
      note:   note.trim()   || null,
    }
    if (kind === 'monthly') {
      const de = clampDay(Number(dayEnd), 31)
      const ds = dayStart.trim() === '' ? 1 : clampDay(Number(dayStart), de)
      onSave({ ...base, kind: 'monthly', dayStart: ds, dayEnd: de, doneMonths: initial?.doneMonths || [] })
    } else {
      onSave({ ...base, kind: 'oneoff', expiry, claimStart: claimStart || null })
    }
  }
  return (
    <div className="form">
      <div className="fld">
        <label>ชื่อสิทธิ์ / คูปอง</label>
        <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น Koi Thé ฿50" />
      </div>
      <div className="fld">
        <label>ประเภท</label>
        <div className="seg">
          {[['oneoff','ครั้งเดียว'],['monthly','รายเดือน']].map(([k, lb]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{lb}</button>
          ))}
        </div>
      </div>
      {kind === 'oneoff' ? (
        <div className="fld">
          <label>วันหมดอายุ</label>
          <input className="inp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
      ) : (
        <div className="fld">
          <label>รับได้วันที่ <span className="opt">(ของทุกเดือน · ไม่ใส่ช่องซ้ายก็ได้)</span></label>
          <div className="prices">
            <div className="price"><span>ตั้งแต่วันที่</span><input inputMode="numeric" value={dayStart} onChange={(e) => setDayStart(onlyDay(e.target.value))} placeholder="1" /></div>
            <div className="price"><span>ถึงวันที่</span><input  inputMode="numeric" value={dayEnd}   onChange={(e) => setDayEnd(onlyDay(e.target.value))}   placeholder="เช่น 5" /></div>
          </div>
        </div>
      )}
      <div className="fld">
        <label>ใช้ที่ร้าน <span className="opt">(ไม่ใส่ก็ได้)</span></label>
        <input className="inp" value={store} onChange={(e) => setStore(e.target.value)} placeholder="เช่น Koi Thé" />
      </div>
      <div className="fld">
        <label>มูลค่า <span className="opt">(ไม่ใส่ก็ได้)</span></label>
        <input className="inp" value={value} onChange={(e) => setValue(e.target.value)} placeholder="เช่น 50 บาท / 15%" />
      </div>
      <div className="fld">
        <label>เจ้าของสิทธิ์ <span className="opt">(ไม่ใส่ก็ได้)</span></label>
        <div className="chips">
          {OWNERS.map((o) => (
            <button key={o} className={`chip${owner === o ? ' on' : ''}`} onClick={() => setOwner((cur) => (cur === o ? '' : o))}>{o}</button>
          ))}
        </div>
        <input className="inp" style={{ marginTop: 8 }} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="หรือพิมพ์ชื่อเอง" />
      </div>
      <div className="fld">
        <label>ได้มาจาก <span className="opt">(ไม่ใส่ก็ได้)</span></label>
        <input className="inp" value={source} onChange={(e) => setSource(e.target.value)} placeholder="เช่น ธอส / uchoose / BLA" />
      </div>
      <div className="fld">
        <label>หลักฐานที่ใช้รับสิทธิ์ <span className="opt">(ไม่ใส่ก็ได้)</span></label>
        <input className="inp" value={proof} onChange={(e) => setProof(e.target.value)} placeholder="เช่น แคปหน้าจอ / บัตรสมาชิก" />
      </div>
      {kind === 'oneoff' && (
        <div className="fld">
          <label>ช่วงเริ่มรับสิทธิ์ <span className="opt">(ไม่ใส่ก็ได้)</span></label>
          <input className="inp" type="date" value={claimStart} onChange={(e) => setClaimStart(e.target.value)} />
        </div>
      )}
      <div className="fld">
        <label>โน้ต <span className="opt">(ไม่บังคับ)</span></label>
        <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ใช้ได้เฉพาะสาขา…" />
      </div>
      <div className="formrow">
        <button className="btn primary" disabled={!canSave} onClick={submit}>{initial ? 'บันทึกการแก้ไข' : 'เพิ่มสิทธิ์'}</button>
        <button className="btn ghost" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  )
}

/* ---------- benefit card ---------- */
function BenefitCard({ b, onToggle, onEdit, onAskDelete }) {
  const [open, setOpen] = useState(false)
  const s = b._s
  const lvl = s.settled ? 'gray' : dueLevel(s.d)
  const dueText = s.monthly
    ? (s.received ? 'รับแล้วเดือนนี้'
      : s.missed  ? 'พลาดเดือนนี้ · กลับมาใหม่เดือนหน้า'
      : `รับภายในวันที่ ${s.dEnd} · ${daysLeftText(s.d)}`)
    : `หมด ${thaiShortDate(b.expiry)}${b.done ? ' · ใช้แล้ว' : ` · ${daysLeftText(s.d)}`}`
  const dim = s.received || (!s.monthly && b.done)
  const hasDetail = b.source || b.proof || b.claimStart || b.note || s.monthly
  return (
    <div className={`bcard${dim ? ' done' : ''}`}>
      <div className="bmain" onClick={() => setOpen((o) => !o)}>
        <div className="btitle">{b.title}</div>
        <div className="bchips">
          {s.monthly ? <span className="bchip month">รายเดือน</span> : null}
          {b.store ? <span className="bchip">{b.store}</span> : null}
          {b.value ? <span className="bchip">{b.value}</span> : null}
          {b.owner ? <span className="bchip">{b.owner}</span> : null}
        </div>
        <div className={`bdue lvl-${lvl}`}>{dueText}</div>
        {open && (
          <div className="bdetail">
            {s.monthly ? <div><span>รับได้:</span> วันที่ {s.dStart}–{s.dEnd} ของทุกเดือน</div> : null}
            {b.source ? <div><span>ได้มาจาก:</span> {b.source}</div> : null}
            {b.proof  ? <div><span>หลักฐาน:</span> {b.proof}</div> : null}
            {!s.monthly && b.claimStart ? <div><span>เริ่มรับ:</span> {thaiShortDate(b.claimStart)}</div> : null}
            {b.note   ? <div><span>โน้ต:</span> {b.note}</div> : null}
            {!hasDetail ? <div className="bempty">ไม่มีรายละเอียดเพิ่มเติม</div> : null}
            <div className="bdetact">
              <button className="iconbtn" onClick={(e) => { e.stopPropagation(); onEdit() }} aria-label="แก้ไข">{IconEdit}</button>
              <button className="iconbtn" onClick={(e) => { e.stopPropagation(); onAskDelete() }} aria-label="ลบ">{IconTrash}</button>
            </div>
          </div>
        )}
      </div>
      {s.monthly ? (
        <button className={`donebtn${s.received ? ' on' : ''}`} onClick={onToggle}>
          {s.received ? <>{IconCheck} เดือนนี้</> : 'รับแล้วเดือนนี้'}
        </button>
      ) : (
        <button className={`donebtn${b.done ? ' on' : ''}`} onClick={onToggle}>
          {b.done ? <>{IconCheck} ใช้แล้ว</> : 'ใช้แล้ว'}
        </button>
      )}
    </div>
  )
}

/* ============================ APP ============================ */
export default function App() {
  const [tab,         setTab]         = useState('restaurants')
  const [restaurants, setRestaurants] = useState([])
  const [laundry,     setLaundry]     = useState({})
  const [benefits,    setBenefits]    = useState([])
  const [ready,       setReady]       = useState(false)
  const [saveError,   setSaveError]   = useState(false)

  const [view, setView] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [justSet, setJustSet] = useState(null)

  // restaurant ui state
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [viewMode,  setViewMode]  = useState('full')
  const [adding,    setAdding]    = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  // benefits ui state
  const [benView,    setBenView]    = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [benSelDay,  setBenSelDay]  = useState(null)
  const [benAdding,  setBenAdding]  = useState(false)
  const [benEditId,  setBenEditId]  = useState(null)
  const [benConfId,  setBenConfId]  = useState(null)
  const [benShowOld, setBenShowOld] = useState(false)

  // refs for dedup realtime echoes (we get our own writes back)
  const restRef = useRef(null)
  const launRef = useRef(null)
  const benRef  = useRef(null)

  // env check
  const envOk = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

  /* ---- initial load + realtime subscription ---- */
  useEffect(() => {
    let alive = true

    // Load initial data
    Promise.all([getJSON(K.restaurants), getJSON(K.laundry), getJSON(K.benefits)]).then(([r, l, b]) => {
      if (!alive) return
      if (r)      { restRef.current = JSON.stringify(r); setRestaurants(r) }
      if (l)      { launRef.current = JSON.stringify(l); setLaundry(l) }
      if (b)      { benRef.current  = JSON.stringify(b); setBenefits(b) }
      setReady(true)
    })

    // Realtime: ได้รับการเปลี่ยนแปลงจากทุกคนในครอบครัว (ทันที ไม่ต้อง poll)
    const channel = supabase.channel('fh-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_data' }, (payload) => {
        if (!alive || !payload.new) return
        const { key, value } = payload.new
        const s = JSON.stringify(value)
        if (key === K.restaurants && s !== restRef.current) { restRef.current = s; setRestaurants(value) }
        if (key === K.laundry     && s !== launRef.current) { launRef.current = s; setLaundry(value) }
        if (key === K.benefits    && s !== benRef.current)  { benRef.current  = s; setBenefits(value) }
      })
      .subscribe()

    return () => { alive = false; supabase.removeChannel(channel) }
  }, [])

  /* ---- mutations ---- */
  const saveRest = useCallback(async (updater) => {
    const cur  = (await getJSON(K.restaurants)) ?? restaurants
    const next = updater(cur)
    setRestaurants(next)
    restRef.current = JSON.stringify(next)
    const ok = await setJSON(K.restaurants, next)
    if (!ok) setSaveError(true)
  }, [restaurants])

  const addRestaurant    = (data)     => saveRest((cur) => [{ id: uid(), createdAt: Date.now(), ...data }, ...cur])
  const updateRestaurant = (id, data) => saveRest((cur) => cur.map((r) => (r.id === id ? { ...r, ...data } : r)))
  const removeRestaurant = (id)       => saveRest((cur) => cur.filter((r) => r.id !== id))

  const saveBen = useCallback(async (updater) => {
    const cur  = (await getJSON(K.benefits)) ?? benefits
    const next = updater(cur)
    setBenefits(next)
    benRef.current = JSON.stringify(next)
    const ok = await setJSON(K.benefits, next)
    if (!ok) setSaveError(true)
  }, [benefits])

  const addBenefit    = (data)     => saveBen((cur) => [{ id: uid(), createdAt: Date.now(), done: false, ...data }, ...cur])
  const updateBenefit = (id, data) => saveBen((cur) => cur.map((b) => (b.id === id ? { ...b, ...data } : b)))
  const removeBenefit = (id)       => saveBen((cur) => cur.filter((b) => b.id !== id))
  const toggleBenDone = (id)       => saveBen((cur) => cur.map((b) => (b.id === id ? { ...b, done: !b.done, doneAt: !b.done ? new Date().toISOString() : null } : b)))
  const toggleBenMonth = (id, ym)  => saveBen((cur) => cur.map((b) => {
    if (b.id !== id) return b
    const months = b.doneMonths || []
    const has = months.includes(ym)
    return { ...b, doneMonths: has ? months.filter((x) => x !== ym) : [...months, ym] }
  }))

  const setDay = useCallback(async (dateKey, personId) => {
    const cur  = (await getJSON(K.laundry)) ?? laundry
    const next = { ...cur }
    if (!personId) delete next[dateKey]
    else next[dateKey] = { person: personId, at: new Date().toISOString() }
    setLaundry(next)
    launRef.current = JSON.stringify(next)
    const ok = await setJSON(K.laundry, next)
    if (!ok) setSaveError(true)
  }, [laundry])

  const flash = (key) => { setJustSet(key); setTimeout(() => setJustSet((k) => (k === key ? null : k)), 420) }

  const onCellTap = useCallback((key) => {
    const cur   = laundry[key]?.person ?? null
    const order = [null, 'jelly', 'mint']
    const nx    = order[(order.indexOf(cur) + 1) % 3]
    setDay(key, nx)
    if (nx) flash(key)
  }, [laundry, setDay])

  /* ---- laundry derived ---- */
  const today     = new Date()
  const todayKey  = ymd(today)
  const todayPerson = laundry[todayKey]?.person ?? null
  const todayAt     = laundry[todayKey]?.at ?? null

  const lastEntry = useMemo(() => {
    const keys = Object.keys(laundry).filter((k) => laundry[k]?.person && k <= todayKey).sort()
    if (!keys.length) return null
    const k = keys[keys.length - 1]
    return { date: k, person: laundry[k].person }
  }, [laundry, todayKey])

  const nextPerson = lastEntry ? other(lastEntry.person) : ROTATION_START
  const shown      = todayPerson ?? nextPerson

  const onCheckin = useCallback(() => {
    const nx = todayPerson == null ? nextPerson : other(todayPerson)
    setDay(todayKey, nx)
    flash(todayKey)
  }, [todayPerson, nextPerson, todayKey, setDay])

  const prev = addMons(view.y, view.m, -1)
  const next = addMons(view.y, view.m,  1)
  const onThisMonth = view.y === today.getFullYear() && view.m === today.getMonth()

  /* ---- restaurants derived ---- */
  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return restaurants.filter((r) => {
      if (filter !== 'all' && r.ice !== filter) return false
      if (!q) return true
      return (r.name || '').toLowerCase().includes(q) || (r.area || '').toLowerCase().includes(q)
    })
  }, [restaurants, search, filter])

  const iceList = useMemo(
    () => [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th')),
    [list]
  )

  /* ---- benefits derived ---- */
  const thisMonthKey = todayKey.slice(0, 7) // 'YYYY-MM'
  const benAug = useMemo(
    () => benefits.map((b) => { const s = benStatus(b, todayKey); return { ...b, _s: s, _d: s.d } }),
    [benefits, todayKey]
  )
  // active = oneoff ที่ยังไม่ใช้/ไม่หมด, monthly ที่เดือนนี้ยังไม่รับและยังไม่เลย dayEnd
  const activeBen = useMemo(
    () => benAug.filter((b) => !b._s.settled).sort((a, b) => (a._d ?? 1e9) - (b._d ?? 1e9)),
    [benAug]
  )
  const oldBen = useMemo(
    () => benAug.filter((b) => b._s.settled).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')),
    [benAug]
  )
  const soonBen = useMemo(
    () => activeBen.filter((b) => b._d != null && b._d <= SOON_DAYS),
    [activeBen]
  )
  // marker ปฏิทิน: oneoff ที่ active วางที่ expiry, monthly วางที่ dayEnd ของเดือนที่กำลังดู
  const benDueMap = useMemo(() => {
    const map = {}
    const { y, m } = benView
    const ymView = `${y}-${pad(m + 1)}`
    for (const b of benAug) {
      if (b.kind === 'monthly') {
        if ((b.doneMonths || []).includes(ymView)) continue
        ;(map[monthlyDueKey(b, y, m)] ??= []).push(b)
      } else {
        if (b._s.settled || !b.expiry) continue
        ;(map[b.expiry] ??= []).push(b)
      }
    }
    return map
  }, [benAug, benView])
  const shownBen = useMemo(
    () => (benSelDay ? (benDueMap[benSelDay] || []) : activeBen),
    [activeBen, benSelDay, benDueMap]
  )

  const benPrev = addMons(benView.y, benView.m, -1)
  const benNext = addMons(benView.y, benView.m,  1)
  const benOnThisMonth = benView.y === today.getFullYear() && benView.m === today.getMonth()

  return (
    <div className="fh">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="appname">{APP_NAME}</div>
        <div className="appsub">{APP_SUB}</div>

        {!envOk && (
          <div className="warn">
            ⚠️ ยังไม่ได้ตั้งค่า Supabase — ดู SETUP.md แล้วเพิ่ม VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY ใน .env
          </div>
        )}
        {saveError && (
          <div className="warn" style={{ background: '#FEE2E2', borderColor: '#FCA5A5', color: '#991B1B' }}>
            บันทึกไม่สำเร็จ — ตรวจสอบการเชื่อมต่อหรือ Supabase credentials
            <button onClick={() => setSaveError(false)} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
          </div>
        )}

        <div className="tabs">
          <button className={`tab${tab === 'restaurants' ? ' active' : ''}`} onClick={() => setTab('restaurants')}>{IconRest} ร้านอาหาร</button>
          <button className={`tab${tab === 'laundry'     ? ' active' : ''}`} onClick={() => setTab('laundry')}>{IconLaundry} เวรตากผ้า</button>
          <button className={`tab${tab === 'benefits'    ? ' active' : ''}`} onClick={() => setTab('benefits')}>{IconTicket} สิทธิ์</button>
        </div>

        {!ready ? (
          <div className="empty">กำลังโหลด…</div>
        ) : tab === 'laundry' ? (
          <>
            {/* การ์ดบอกคิว */}
            <div className={`hero ${nextPerson}`}>
              <div className="stampbig"><Stamp shape={PEOPLE[nextPerson].shape} color={PEOPLE[nextPerson].color} size={40} /></div>
              <div className="herotxt">
                <div className="label">คิวต่อไป</div>
                <div className="who">{PEOPLE[nextPerson].name}</div>
                <div className="sub">
                  {lastEntry
                    ? `ล่าสุด ${thaiShortDate(lastEntry.date)} เป็นคิวของ ${PEOPLE[lastEntry.person].name}`
                    : `ยังไม่มีประวัติ เริ่มที่ ${PEOPLE[ROTATION_START].name} ได้เลย`}
                </div>
              </div>
            </div>

            {/* ปุ่มเช็กอินวันนี้ */}
            <button className={`cbtn ${shown}`} onClick={onCheckin}>
              <div className="ico"><Stamp shape={PEOPLE[shown].shape} color={PEOPLE[shown].color} size={24} /></div>
              <div className="txt">
                {todayPerson ? (
                  <>
                    <div className="t1">วันนี้: {PEOPLE[todayPerson].name} ตากผ้า</div>
                    <div className="t2">{timeOf(todayAt)} น. · แตะอีกครั้งเพื่อสลับเป็น {PEOPLE[other(todayPerson)].name}</div>
                  </>
                ) : (
                  <>
                    <div className="t1">เช็กอินวันนี้ — คิวของ {PEOPLE[nextPerson].name}</div>
                    <div className="t2">แตะเพื่อบันทึกว่า {PEOPLE[nextPerson].name} ตากผ้าวันนี้</div>
                  </>
                )}
              </div>
              <div className="chev">›</div>
            </button>

            {/* ปฏิทินเดือนปัจจุบัน */}
            <div className="calcard">
              <div className="calhead">
                <button className="navbtn" onClick={() => setView(prev)} aria-label="เดือนก่อน">‹</button>
                <div className="mname">{TH_MONTH[view.m]} {beYear(view.y)}</div>
                <button className="navbtn" onClick={() => setView(next)} aria-label="เดือนถัดไป">›</button>
              </div>
              <div className="dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
              <MonthCalendar y={view.y} m={view.m} laundry={laundry} todayKey={todayKey} onCellTap={onCellTap} justSet={justSet} />
              {!onThisMonth && (
                <button className="todaybtn" onClick={() => { const d = new Date(); setView({ y: d.getFullYear(), m: d.getMonth() }) }}>
                  กลับมาเดือนนี้
                </button>
              )}
              <div className="legend">
                <div className="hint">แตะวันในปฏิทินเพื่อสลับเวร — กดวนไป: ว่าง → เยลลี่ → มิ้น → ว่าง</div>
                <div className="keys">
                  <span className="key"><Stamp shape="heart" color={PEOPLE.jelly.color} size={15} /> {PEOPLE.jelly.name}</span>
                  <span className="key"><Stamp shape="star"  color={PEOPLE.mint.color}  size={15} /> {PEOPLE.mint.name}</span>
                </div>
              </div>
            </div>

            {/* ปฏิทินเล็ก เดือนก่อน / เดือนถัดไป */}
            <div className="minis">
              <MiniMonth y={prev.y} m={prev.m} role="เดือนก่อน"  laundry={laundry} />
              <MiniMonth y={next.y} m={next.m} role="เดือนถัดไป" laundry={laundry} />
            </div>
          </>
        ) : tab === 'benefits' ? (
          <>
            {/* แถบใกล้หมด */}
            {soonBen.length > 0 && (
              <div className="soonbar">
                <div className="soonhead">⏰ ใกล้หมดอายุ</div>
                {soonBen.map((b) => (
                  <div key={b.id} className={`soonitem lvl-${dueLevel(b._d)}`}>
                    <span className="sname">{b.title}{b.store ? <span className="sstore"> · {b.store}</span> : null}</span>
                    <span className="sdays">{daysLeftText(b._d)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ปฏิทิน */}
            <div className="calcard">
              <div className="calhead">
                <button className="navbtn" onClick={() => setBenView(benPrev)} aria-label="เดือนก่อน">‹</button>
                <div className="mname">{TH_MONTH[benView.m]} {beYear(benView.y)}</div>
                <button className="navbtn" onClick={() => setBenView(benNext)} aria-label="เดือนถัดไป">›</button>
              </div>
              <div className="dow">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
              <BenefitCalendar
                y={benView.y} m={benView.m} dueMap={benDueMap} todayKey={todayKey}
                selectedDay={benSelDay}
                onCellTap={(key) => setBenSelDay((cur) => (cur === key ? null : (benDueMap[key] ? key : cur)))}
              />
              {!benOnThisMonth && (
                <button className="todaybtn" onClick={() => { const d = new Date(); setBenView({ y: d.getFullYear(), m: d.getMonth() }) }}>
                  กลับมาเดือนนี้
                </button>
              )}
              <div className="legend">
                <div className="keys">
                  <span className="key"><span className="due due-red" /> ≤{URGENT_DAYS} วัน</span>
                  <span className="key"><span className="due due-orange" /> ≤{SOON_DAYS} วัน</span>
                  <span className="key"><span className="due due-gray" /> อื่น ๆ</span>
                </div>
              </div>
            </div>

            {benSelDay && (
              <div className="selbar">
                <span>เฉพาะวันที่ {thaiShortDate(benSelDay)}</span>
                <button onClick={() => setBenSelDay(null)}>ดูทั้งหมด</button>
              </div>
            )}

            {!benAdding && !benEditId && (
              <button className="addbtn" onClick={() => setBenAdding(true)}>+ เพิ่มสิทธิ์ / คูปอง</button>
            )}
            {benAdding && (
              <BenefitForm
                onSave={(d) => { addBenefit(d); setBenAdding(false) }}
                onCancel={() => setBenAdding(false)}
              />
            )}

            <div className="blist">
              {shownBen.length === 0 ? (
                <div className="empty">
                  {benefits.length === 0
                    ? 'ยังไม่มีสิทธิ์ในลิสต์\nเพิ่มคูปอง/สิทธิ์เพื่อกันลืมใช้ก่อนหมดอายุ'
                    : (benSelDay ? 'ไม่มีสิทธิ์ที่หมดในวันนี้' : 'ไม่มีสิทธิ์ที่ยังใช้ได้')}
                </div>
              ) : (
                shownBen.map((b) =>
                  benEditId === b.id ? (
                    <BenefitForm
                      key={b.id}
                      initial={b}
                      onSave={(d) => { updateBenefit(b.id, d); setBenEditId(null) }}
                      onCancel={() => setBenEditId(null)}
                    />
                  ) : benConfId === b.id ? (
                    <div className="bcard confirm" key={b.id}>
                      <div className="bmain">
                        <div className="btitle">ลบ &quot;{b.title}&quot; ?</div>
                        <div className="bdue lvl-gray">การลบนี้ย้อนกลับไม่ได้</div>
                      </div>
                      <div className="formrow tight">
                        <button className="btn danger" onClick={() => { removeBenefit(b.id); setBenConfId(null) }}>ลบ</button>
                        <button className="btn ghost"  onClick={() => setBenConfId(null)}>ยกเลิก</button>
                      </div>
                    </div>
                  ) : (
                    <BenefitCard
                      key={b.id} b={b}
                      onToggle={() => b.kind === 'monthly' ? toggleBenMonth(b.id, thisMonthKey) : toggleBenDone(b.id)}
                      onEdit={() => { setBenEditId(b.id); setBenAdding(false) }}
                      onAskDelete={() => setBenConfId(b.id)}
                    />
                  )
                )
              )}
            </div>

            {oldBen.length > 0 && (
              <div className="oldsec">
                <button className="oldhead" onClick={() => setBenShowOld((o) => !o)}>
                  ใช้แล้ว / หมดอายุ ({oldBen.length}) <span className="chev">{benShowOld ? '▴' : '▾'}</span>
                </button>
                {benShowOld && (
                  <div className="blist">
                    {oldBen.map((b) =>
                      benEditId === b.id ? (
                        <BenefitForm
                          key={b.id}
                          initial={b}
                          onSave={(d) => { updateBenefit(b.id, d); setBenEditId(null) }}
                          onCancel={() => setBenEditId(null)}
                        />
                      ) : benConfId === b.id ? (
                        <div className="bcard confirm" key={b.id}>
                          <div className="bmain">
                            <div className="btitle">ลบ &quot;{b.title}&quot; ?</div>
                            <div className="bdue lvl-gray">การลบนี้ย้อนกลับไม่ได้</div>
                          </div>
                          <div className="formrow tight">
                            <button className="btn danger" onClick={() => { removeBenefit(b.id); setBenConfId(null) }}>ลบ</button>
                            <button className="btn ghost"  onClick={() => setBenConfId(null)}>ยกเลิก</button>
                          </div>
                        </div>
                      ) : (
                        <BenefitCard
                          key={b.id} b={b}
                          onToggle={() => b.kind === 'monthly' ? toggleBenMonth(b.id, thisMonthKey) : toggleBenDone(b.id)}
                          onEdit={() => { setBenEditId(b.id); setBenAdding(false) }}
                          onAskDelete={() => setBenConfId(b.id)}
                        />
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {/* ค้นหา + กรอง */}
            <div className="search">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8A7F75" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อร้าน หรือย่าน" />
            </div>
            <div className="chips">
              {[['all','ทั้งหมด'],['free','ฟรี'],['paid','มีค่าใช้จ่าย'],['unknown','ยังไม่ได้เช็ก']].map(([k, lb]) => (
                <button key={k} className={`chip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{lb}</button>
              ))}
            </div>

            <div className="seg viewseg">
              {[['full','การ์ดเต็ม'],['ice','สรุปน้ำแข็ง']].map(([k, lb]) => (
                <button key={k} className={viewMode === k ? 'on' : ''} onClick={() => setViewMode(k)}>{lb}</button>
              ))}
            </div>

            {viewMode === 'full' && !adding && !editingId && (
              <button className="addbtn" onClick={() => setAdding(true)}>+ เพิ่มร้านใหม่</button>
            )}
            {viewMode === 'full' && adding && (
              <RestaurantForm
                onSave={(d) => { addRestaurant(d); setAdding(false) }}
                onCancel={() => setAdding(false)}
              />
            )}

            {viewMode === 'ice' ? (
              <div className="ilist">
                {iceList.length === 0 ? (
                  <div className="empty">
                    {restaurants.length === 0
                      ? 'ยังไม่มีร้านในลิสต์'
                      : 'ไม่พบร้านที่ตรงกับที่ค้นหา'}
                  </div>
                ) : (
                  iceList.map((r) => <IceRow key={r.id} r={r} />)
                )}
              </div>
            ) : (
            <div className="rlist">
              {list.length === 0 ? (
                <div className="empty">
                  {restaurants.length === 0
                    ? 'ยังไม่มีร้านในลิสต์\nเพิ่มร้านแรกเพื่อเริ่มจดว่าที่ไหนมีน้ำแข็งฟรีบ้าง'
                    : 'ไม่พบร้านที่ตรงกับที่ค้นหา'}
                </div>
              ) : (
                list.map((r) =>
                  editingId === r.id ? (
                    <RestaurantForm
                      key={r.id}
                      initial={r}
                      onSave={(d) => { updateRestaurant(r.id, d); setEditingId(null) }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : confirmId === r.id ? (
                    <div className="rcard confirm" key={r.id}>
                      <div className="rmain">
                        <div className="rname">ลบ &quot;{r.name}&quot; ?</div>
                        <div className="rarea">การลบนี้ย้อนกลับไม่ได้</div>
                      </div>
                      <div className="formrow tight">
                        <button className="btn danger" onClick={() => { removeRestaurant(r.id); setConfirmId(null) }}>ลบ</button>
                        <button className="btn ghost"  onClick={() => setConfirmId(null)}>ยกเลิก</button>
                      </div>
                    </div>
                  ) : (
                    <RestaurantCard
                      key={r.id} r={r}
                      onEdit={() => { setEditingId(r.id); setAdding(false) }}
                      onAskDelete={() => setConfirmId(r.id)}
                    />
                  )
                )
              )}
            </div>
            )}
          </>
        )}

        <div className="footer">ข้อมูล sync อัตโนมัติ · My fam</div>
      </div>
    </div>
  )
}

/* ============================ CSS ============================ */
const CSS = `
.fh *{box-sizing:border-box}
.fh{
  --paper:#FAF6F0;--paper-2:#F2EBE0;--card:#fff;--ink:#2C2620;--ink-soft:#8A7F75;--line:#ECE4D9;
  --orange:#F07C36;--orange-wash:#FCE6D4;--orange-ink:#A8501C;
  --mint:#1FB892;--mint-wash:#D6F2E9;--mint-ink:#0C7355;
  --radius:18px;--shadow:0 1px 2px rgba(44,38,32,.04),0 10px 30px rgba(44,38,32,.07);
  min-height:100vh;background:var(--paper);color:var(--ink);font-family:'IBM Plex Sans Thai',system-ui,sans-serif;-webkit-font-smoothing:antialiased;
}
.fh .wrap{max-width:520px;margin:0 auto;padding:20px 16px 44px}
.fh .appname{font-family:'Mali',system-ui,sans-serif;font-weight:700;font-size:25px;letter-spacing:.2px}
.fh .appsub{color:var(--ink-soft);font-size:13px;margin-top:1px}
.fh .warn{background:#FFF4E5;border:1px solid #F4D8A8;color:#8A5A12;border-radius:12px;padding:10px 12px;font-size:12.5px;margin-top:14px;display:flex;align-items:center}

.fh .tabs{display:flex;gap:6px;background:var(--paper-2);padding:5px;border-radius:14px;margin:16px 0 18px}
.fh .tab{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;border:0;background:transparent;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:14.5px;color:var(--ink-soft);padding:10px 8px;border-radius:10px;cursor:pointer}
.fh .tab.active{background:var(--card);color:var(--ink);box-shadow:var(--shadow)}
.fh .tab svg{width:18px;height:18px}

.fh .hero{border-radius:22px;padding:20px;display:flex;align-items:center;gap:16px}
.fh .hero.jelly{background:linear-gradient(135deg,var(--orange-wash),#fff)}
.fh .hero.mint{background:linear-gradient(135deg,var(--mint-wash),#fff)}
.fh .hero .stampbig{flex:0 0 auto;width:72px;height:72px;border-radius:18px;background:rgba(255,255,255,.6);display:flex;align-items:center;justify-content:center}
.fh .hero .label{font-size:13px;font-weight:600;letter-spacing:.3px;color:var(--ink-soft);margin-bottom:3px}
.fh .hero .who{font-family:'Mali',system-ui,sans-serif;font-weight:700;font-size:28px;line-height:1.35}
.fh .hero .sub{font-size:12.5px;color:var(--ink-soft);margin-top:7px;line-height:1.4}

.fh .cbtn{width:100%;margin-top:14px;border:1.5px solid var(--line);background:var(--card);border-radius:16px;padding:13px 14px;display:flex;align-items:center;gap:13px;cursor:pointer;box-shadow:var(--shadow);text-align:left}
.fh .cbtn.jelly{border-color:var(--orange)}
.fh .cbtn.mint{border-color:var(--mint)}
.fh .cbtn .ico{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:var(--paper-2);flex:0 0 auto}
.fh .cbtn .txt{flex:1;min-width:0}
.fh .cbtn .t1{font-weight:600;font-size:15px}
.fh .cbtn .t2{font-size:12px;color:var(--ink-soft);margin-top:2px;font-family:'IBM Plex Mono',ui-monospace,monospace}
.fh .cbtn .chev{color:var(--ink-soft);font-size:22px;line-height:1}

.fh .calcard{background:var(--card);border-radius:20px;box-shadow:var(--shadow);padding:14px;margin-top:18px}
.fh .calhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.fh .calhead .mname{font-family:'Mali',system-ui,sans-serif;font-weight:600;font-size:17px}
.fh .navbtn{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:var(--card);cursor:pointer;font-size:18px;color:var(--ink);display:flex;align-items:center;justify-content:center}
.fh .dow{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px}
.fh .dow span{text-align:center;font-size:11px;color:var(--ink-soft);font-weight:600}
.fh .grid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:46px;gap:4px}
.fh .cell{height:46px;border-radius:11px;border:1.5px solid transparent;background:var(--paper);display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer;padding:0;overflow:hidden}
.fh .cell.empty{background:transparent;cursor:default;border:none}
.fh .cell .dn{position:absolute;top:3px;left:6px;font-size:10px;color:var(--ink-soft);font-family:'IBM Plex Mono',ui-monospace,monospace}
.fh .cell.today{border-color:var(--ink)}
.fh .cell.has-jelly{background:var(--orange-wash)}
.fh .cell.has-mint{background:var(--mint-wash)}
.fh .todaybtn{margin-top:10px;width:100%;border:1px solid var(--line);background:var(--paper);border-radius:11px;padding:9px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:13px;color:var(--ink-soft);cursor:pointer}
.fh .legend{margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.fh .legend .hint{font-size:12px;color:var(--ink-soft);line-height:1.5}
.fh .legend .keys{display:flex;gap:16px;margin-top:8px}
.fh .legend .key{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:600;color:var(--ink)}

.fh .minis{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.fh .mini{background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:10px}
.fh .mini .mh{font-size:11.5px;font-weight:600;color:var(--ink-soft);text-align:center;margin-bottom:6px}
.fh .mini .mdow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:2px}
.fh .mini .mdow span{font-size:8px;text-align:center;color:var(--ink-soft)}
.fh .mini .mgrid{display:grid;grid-template-columns:repeat(7,1fr);grid-auto-rows:27px;gap:2px}
.fh .mcell{height:27px;border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}
.fh .mcell .mn{font-size:9px;line-height:1;color:var(--ink-soft);font-family:'IBM Plex Mono',ui-monospace,monospace}

.fh .search{display:flex;align-items:center;gap:9px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:11px 13px;box-shadow:var(--shadow)}
.fh .search input{border:0;outline:0;flex:1;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-size:15px;background:transparent;color:var(--ink)}
.fh .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.fh .chip{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:7px 14px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-size:13px;font-weight:600;color:var(--ink-soft);cursor:pointer}
.fh .chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.fh .addbtn{margin-top:14px;width:100%;border:1.5px dashed #D9CFC0;background:transparent;border-radius:14px;padding:14px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:14.5px;color:var(--ink-soft);cursor:pointer}

.fh .form{background:var(--card);border-radius:18px;box-shadow:var(--shadow);padding:16px;margin-top:14px}
.fh .fld{margin-bottom:13px}
.fh .fld label{display:block;font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:6px}
.fh .fld label .opt{color:var(--ink-soft);font-weight:400}
.fh .inp{width:100%;border:1px solid var(--line);border-radius:11px;padding:11px 12px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-size:15px;color:var(--ink);outline:0;background:var(--paper)}
.fh .inp:focus{border-color:var(--ink);background:#fff}
.fh .seg{display:flex;gap:6px}
.fh .seg button{flex:1;border:1px solid var(--line);background:var(--paper);border-radius:11px;padding:10px 4px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:13px;color:var(--ink-soft);cursor:pointer}
.fh .seg button.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.fh .prices{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.fh .price{display:flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:11px;padding:9px 11px;background:var(--paper)}
.fh .price span{font-size:13px;color:var(--ink-soft);white-space:nowrap}
.fh .price input{border:0;outline:0;background:transparent;width:100%;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:15px;color:var(--ink);text-align:right}
.fh .formrow{display:flex;gap:10px;margin-top:4px}
.fh .formrow.tight{margin-top:0}
.fh .btn{border:0;border-radius:12px;padding:12px 16px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:14.5px;cursor:pointer}
.fh .btn.primary{background:var(--ink);color:#fff;flex:1}
.fh .btn.primary:disabled{opacity:.4;cursor:not-allowed}
.fh .btn.ghost{background:var(--paper-2);color:var(--ink)}
.fh .btn.danger{background:#D9483B;color:#fff}

.fh .viewseg{margin-top:12px}
.fh .ilist{margin-top:16px;display:flex;flex-direction:column;gap:7px}
.fh .irow{background:var(--card);border-radius:12px;box-shadow:var(--shadow);padding:11px 14px;display:flex;align-items:center;gap:10px}
.fh .irow .iname{flex:1;min-width:0;font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh .ibadge{flex:0 0 auto;border-radius:999px;padding:4px 11px;font-size:12.5px;font-weight:600;line-height:1.2}
.fh .ibadge.free{background:var(--mint-wash);color:var(--mint-ink)}
.fh .ibadge.paid{background:var(--orange-wash);color:var(--orange-ink);font-family:'IBM Plex Mono',ui-monospace,monospace}
.fh .ibadge.unknown{background:var(--paper-2);color:var(--ink-soft)}

.fh .rlist{margin-top:16px;display:flex;flex-direction:column;gap:10px}
.fh .rcard{background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:14px;display:flex;align-items:flex-start;gap:12px}
.fh .rcard.confirm{align-items:center}
.fh .rcard .rmain{flex:1;min-width:0}
.fh .rname{font-family:'Mali',system-ui,sans-serif;font-weight:600;font-size:17px;word-break:break-word}
.fh .rarea{font-size:13px;color:var(--ink-soft);margin-top:1px}
.fh .badges{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}
.fh .badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:600;line-height:1.2}
.fh .badge.free{background:var(--mint-wash);color:var(--mint-ink)}
.fh .badge.paid{background:var(--orange-wash);color:var(--orange-ink)}
.fh .badge.unknown{background:var(--paper-2);color:var(--ink-soft)}
.fh .badge.water{background:#E6EFF4;color:#3D6675}
.fh .badge .pm{font-family:'IBM Plex Mono',ui-monospace,monospace;font-weight:600}
.fh .badge .mid{opacity:.6}
.fh .rnote{margin-top:8px;font-size:12.5px;line-height:1.5;color:var(--ink-soft);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh .rnote.open{white-space:normal;overflow:visible;word-break:break-word}
.fh .ract{display:flex;flex-direction:column;gap:6px;flex:0 0 auto}
.fh .iconbtn{width:32px;height:32px;border-radius:9px;border:1px solid var(--line);background:var(--card);cursor:pointer;color:var(--ink-soft);display:flex;align-items:center;justify-content:center}

.fh .empty{text-align:center;color:var(--ink-soft);padding:34px 16px;font-size:14px;line-height:1.7;white-space:pre-line}
.fh .footer{text-align:center;color:var(--ink-soft);font-size:11.5px;margin-top:28px;line-height:1.6}

/* ---- benefits ---- */
.fh .tabs{flex-wrap:nowrap;overflow-x:auto}
.fh .tab{white-space:nowrap}

.fh .soonbar{background:var(--orange-wash);border:1px solid #F4C9A6;border-radius:16px;padding:12px 14px;margin-bottom:14px}
.fh .soonhead{font-weight:700;font-size:13.5px;color:var(--orange-ink);margin-bottom:8px}
.fh .soonitem{display:flex;align-items:center;gap:10px;padding:6px 0;border-top:1px solid rgba(168,80,28,.12)}
.fh .soonitem:first-of-type{border-top:0}
.fh .soonitem .sname{flex:1;min-width:0;font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fh .soonitem .sstore{color:var(--ink-soft);font-weight:400}
.fh .soonitem .sdays{flex:0 0 auto;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12.5px;font-weight:700}
.fh .soonitem.lvl-red .sdays{color:#B91C1C}
.fh .soonitem.lvl-orange .sdays{color:var(--orange-ink)}
.fh .soonitem.lvl-gray .sdays{color:var(--ink-soft)}

.fh .cell.sel{border-color:var(--ink);box-shadow:0 0 0 1.5px var(--ink) inset}
.fh .due{position:absolute;bottom:5px;left:50%;transform:translateX(-50%);min-width:8px;height:8px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;line-height:1;padding:0 3px;font-family:'IBM Plex Mono',ui-monospace,monospace}
.fh .due:empty{padding:0;width:8px}
.fh .due-red{background:#D9483B}
.fh .due-orange{background:var(--orange)}
.fh .due-gray{background:var(--ink-soft)}
.fh .legend .key .due{position:static;transform:none}

.fh .selbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;background:var(--paper-2);border-radius:12px;padding:9px 14px;font-size:13px;font-weight:600;color:var(--ink)}
.fh .selbar button{border:0;background:var(--ink);color:#fff;border-radius:999px;padding:6px 13px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:12.5px;cursor:pointer}

.fh .blist{margin-top:14px;display:flex;flex-direction:column;gap:10px}
.fh .bcard{background:var(--card);border-radius:16px;box-shadow:var(--shadow);padding:14px;display:flex;align-items:flex-start;gap:12px}
.fh .bcard.confirm{align-items:center}
.fh .bcard.done{opacity:.62}
.fh .bcard .bmain{flex:1;min-width:0;cursor:pointer}
.fh .btitle{font-family:'Mali',system-ui,sans-serif;font-weight:600;font-size:16px;word-break:break-word}
.fh .bchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.fh .bchip{background:var(--paper-2);color:var(--ink-soft);border-radius:999px;padding:3px 10px;font-size:11.5px;font-weight:600}
.fh .bchip.month{background:var(--mint-wash);color:var(--mint-ink)}
.fh .bdue{margin-top:8px;font-size:12.5px;font-weight:600;font-family:'IBM Plex Mono',ui-monospace,monospace}
.fh .bdue.lvl-red{color:#B91C1C}
.fh .bdue.lvl-orange{color:var(--orange-ink)}
.fh .bdue.lvl-gray{color:var(--ink-soft)}
.fh .bdetail{margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:12.5px;line-height:1.7;color:var(--ink)}
.fh .bdetail span{color:var(--ink-soft)}
.fh .bdetail .bempty{color:var(--ink-soft)}
.fh .bdetact{display:flex;gap:8px;margin-top:10px}
.fh .donebtn{flex:0 0 auto;align-self:flex-start;border:1.5px solid var(--mint);background:var(--card);color:var(--mint-ink);border-radius:11px;padding:8px 12px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.fh .donebtn.on{background:var(--mint-wash)}

.fh .oldsec{margin-top:18px}
.fh .oldhead{width:100%;border:1px solid var(--line);background:var(--paper);border-radius:12px;padding:11px 14px;font-family:'IBM Plex Sans Thai',system-ui,sans-serif;font-weight:600;font-size:13.5px;color:var(--ink-soft);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.fh .oldhead .chev{font-size:11px}

.fh button:focus-visible,.fh input:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
@keyframes fhpop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
.fh .stamp.pop{animation:fhpop .28s ease-out}
@media(prefers-reduced-motion:reduce){.fh .stamp.pop{animation:none}}
`
