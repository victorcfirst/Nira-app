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
}

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
function timeOf(iso) {
  try { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` } catch { return '' }
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

/* ============================ APP ============================ */
export default function App() {
  const [tab,         setTab]         = useState('restaurants')
  const [restaurants, setRestaurants] = useState([])
  const [laundry,     setLaundry]     = useState({})
  const [ready,       setReady]       = useState(false)
  const [saveError,   setSaveError]   = useState(false)

  const [view, setView] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [justSet, setJustSet] = useState(null)

  // restaurant ui state
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [adding,    setAdding]    = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [confirmId, setConfirmId] = useState(null)

  // refs for dedup realtime echoes (we get our own writes back)
  const restRef = useRef(null)
  const launRef = useRef(null)

  // env check
  const envOk = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

  /* ---- initial load + realtime subscription ---- */
  useEffect(() => {
    let alive = true

    // Load initial data
    Promise.all([getJSON(K.restaurants), getJSON(K.laundry)]).then(([r, l]) => {
      if (!alive) return
      if (r)      { restRef.current = JSON.stringify(r); setRestaurants(r) }
      if (l)      { launRef.current = JSON.stringify(l); setLaundry(l) }
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

            {!adding && !editingId && (
              <button className="addbtn" onClick={() => setAdding(true)}>+ เพิ่มร้านใหม่</button>
            )}
            {adding && (
              <RestaurantForm
                onSave={(d) => { addRestaurant(d); setAdding(false) }}
                onCancel={() => setAdding(false)}
              />
            )}

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

.fh button:focus-visible,.fh input:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
@keyframes fhpop{0%{transform:scale(.4);opacity:0}60%{transform:scale(1.14)}100%{transform:scale(1);opacity:1}}
.fh .stamp.pop{animation:fhpop .28s ease-out}
@media(prefers-reduced-motion:reduce){.fh .stamp.pop{animation:none}}
`
