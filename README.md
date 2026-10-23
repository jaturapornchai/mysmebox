# MySMEBox — Open Source ระบบบริหารร้านค้าแม่ค้าออนไลน์ & Solo SME ครบวงจร

> **Open Source Multi-Shop SaaS Platform** สำหรับแม่ค้าออนไลน์และผู้ประกอบการไทย (1 คน = หลายร้านค้า/หลายเพจ)  
> ทดลองใช้งานจริง: **[https://www.mysmebox.com](https://www.mysmebox.com)** · GitHub: **[https://github.com/jaturapornchai/mysmebox](https://github.com/jaturapornchai/mysmebox)**

---

## 1. Objective (วัตถุประสงค์ของระบบ)

**MySMEBox** ออกแบบมาเพื่อให้ **แม่ค้าออนไลน์ (Facebook Live, TikTok Shop, LINE OA, Shopee, Lazada)** และผู้ประกอบการ SME ไทย ใช้งานง่ายที่สุดด้วยภาษาไทยที่เข้าใจง่าย ไม่ต้องตั้งค่าเริ่มต้นเอง เพราะดึงข้อมูลถาวรจากระบบกลางให้อัตโนมัติทั้งหมด:

1. **ปุ่มทดลองเล่น DEMO ทันที (ไม่ต้องผ่าน Google Login)**:
   - ผู้ที่เข้ามาเยี่ยมชมสามารถกดปุ่ม **"🚀 กดทดลองเล่น DEMO ทันที (ไม่ต้องล็อกอิน)"** เพื่อดูรายการสินค้า ร้านค้าตัวอย่าง 3 สาขา บิลขาย รายจ่าย แผนที่จัดส่ง และรายงานกำไร/ภาษีครบทุกหน้าจอ พร้อมปุ่มรีเซ็ตข้อมูล DEMO ใหม่ได้ตลอดเวลา
2. **ข้อมูลถาวรจากระบบกลางพร้อมใช้ทันที (Central Thai Master Data)**:
   - **ธนาคารในประเทศไทย 21 แห่ง + พร้อมเพย์ & ทรูมันนี่ (`sys_banks`)**: มีโลโก้ธนาคาร รหัสธนาคาร และรหัสมาตรฐานธนาคารแห่งประเทศไทย (BOT Code) พร้อมเลือกใช้งานทันที
   - **ฐานข้อมูลภูมิศาสตร์ไทยครบ 100% (`data/thailand_geo.json` & `sys_provinces`)**: ครบทั้ง **77 จังหวัด · 928 อำเภอ/เขต · 7,436 ตำบล/แขวง** พร้อม **รหัสไปรษณีย์อัตโนมัติ (`zip_code`)** และ **พิกัด GPS (`lat`, `lng`)** ทุกตำบลในประเทศไทย
3. **ระบบแผนที่ฟรี (Free OpenStreetMap + Leaflet + Nominatim + GPS)**:
   - ปักหมุดและดูตำแหน่งบนแผนที่จริงได้ฟรี ไม่เสียค่า API Key แยกตามหมวด **🏭 โกดัง/สาขาร้าน (`WAREHOUSE`)**, **📍 ลูกค้าประจำ/ตัวแทน (`CUSTOMER`)**, และ **🚚 จุดส่งพัสดุพร้อมสถานะจัดส่ง (`DELIVERY` — ส่งแล้ว / รอเงิน COD / กำลังนำจ่าย)**
4. **สินค้าหลายหน่วยนับ & บาร์โค้ดตามหน่วยนับ (Multi-UOM & Barcode Engine)**:
   - สินค้า 1 ตัวตั้งหน่วยฐาน (เช่น `ขวด`) เพื่อเก็บสต๊อกจริง (`stock_base`) และตั้งหน่วยขายใหญ่อีกกี่หน่วยก็ได้ (เช่น `แพ็ค 3`, `ยกลัง 24`) ด้วยตัวตั้ง (`standValue`) และตัวหาร (`divideValue`)
   - ผูกบาร์โค้ดแยกตามหน่วยนับ (พร้อมปุ่มสร้างรหัส **EAN-13 อัตโนมัติ** `885` / `200`) และตั้งราคาขายปลีก/ราคาส่งแยกตามหน่วยได้ทันที
5. **1 บัญชี Google ดูแลหลายร้านค้า/หลายเพจ + แบ่งสิทธิ์ลูกน้องด้วย Gmail (Multi-Shop RBAC)**:
   - เจ้าของร้านใช้ Gmail เดียวเปิดกี่เพจ/กี่ร้านก็ได้ และเพิ่ม Gmail ลูกน้อง (แอดมินไลฟ์สด, ฝ่ายแพ็กของ, ฝ่ายบัญชี) โดยซ่อนต้นทุนและกำไรสุทธิจากแอดมินได้
6. **ระบบเชื่อมต่อ MCP (Model Context Protocol) สำหรับ AI ตัวอื่น + Ollama Cloud AI Co-Pilot**:
   - มีทั้ง **HTTP JSON-RPC 2.0 MCP Endpoint (`/api/mcp`)** และ **Stdio Bridge (`mcp-server.js`)** ให้ AI ภายนอก (Claude Desktop, Cursor, Windsurf, Antigravity, Custom AI Agents) ดึงข้อมูลสต๊อก ยอดขาย พิกัดแผนที่ หรือสั่งเปิดบิลอัตโนมัติได้ทันที
7. **ความแม่นยำทางการเงินระดับบัญชี (BigInt Satang Accounting)**:
   - คำนวณเงินทุกชนิด (ราคาสินค้า, ต้นทุน, ค่าส่ง, VAT 7%, หัก ณ ที่จ่าย 1%/3%/5%, กำไรสุทธิ) ด้วยหน่วยย่อย **สตางค์ (`BigInt`)** 100% ปราศจากปัญหาทศนิยมคลาดเคลื่อนจาก Binary Float

---

## 2. Workflow (ขั้นตอนการทำงานหลัก)

```mermaid
flowchart LR
    A["เข้าเว็บ กดปุ่ม DEMO หรือ Google Login"] --> B["เลือกเพจ/ร้านค้าที่ต้องการดูแล"]
    B --> C["ดูดแชทลูกค้า CF / ยิงบาร์โค้ดเปิดบิล (ขวด/แพ็ค/ลัง)"]
    C --> D["เลือก จังหวัด-อำเภอ-ตำบล เติมรหัสไปรษณีย์ + พิกัด GPS อัตโนมัติ"]
    D --> E["ตัดสต๊อกหน่วยฐาน + ปักหมุดแผนที่จัดส่ง + สร้างใบปะหน้ากล่อง & QR พร้อมเพย์"]
    E --> F["เช็คยอดโอน / เก็บเงินปลายทาง COD + จดค่าแอด/หัก 50 ทวิ + ดูรายงานกำไร & ภาษี"]
```

---

## 3. Config (การตั้งค่าสภาพแวดล้อม `.env`)

คัดลอกไฟล์ `.env.example` เป็น `.env` แล้วกำหนดค่าตามสภาพแวดล้อมของเซิร์ฟเวอร์ (ห้ามนำไฟล์ `.env` จริงขึ้น Git โดยเด็ดขาด):

```ini
PORT=3850

# PostgreSQL Database
PG_HOST=127.0.0.1
PG_PORT=5432
PG_DATABASE=mysmebox
PG_USER=postgres
PG_PASSWORD=your_postgres_password_here # pragma: allowlist secret

# MinIO Object Storage (เก็บรูปสินค้า สลิปโอนเงิน และใบเสร็จค่าใช้จ่าย)
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9100
MINIO_BUCKET=mysmebox
MINIO_ACCESS_KEY=your_minio_access_key_here # pragma: allowlist secret
MINIO_SECRET_KEY=your_minio_secret_key_here # pragma: allowlist secret

# Ollama Cloud API (สำหรับฟีเจอร์ AI ดูดแชทเปิดบิล & ที่ปรึกษาร้านค้า)
OLLAMA_API_URL=https://ollama.com/api/chat
OLLAMA_API_KEY=your_ollama_api_key_here # pragma: allowlist secret
OLLAMA_MODEL=gpt-oss:120b
```

---

## 4. Dependency (สิ่งที่ต้องติดตั้ง)

- **Node.js**: เวอร์ชัน `18.0.0` ขึ้นไป (รองรับ Native `fetch` และ `BigInt`)
- **PostgreSQL**: เวอร์ชัน `14` ขึ้นไป (ระบบสร้างตาราง `sys_banks`, `sys_provinces`, `users`, `shops`, `shop_members`, `products`, `bills`, `expenses`, `shop_locations` และ Seed ข้อมูลตัวอย่าง DEMO ให้อัตโนมัติเมื่อรันครั้งแรก)
- **MinIO** (ทางเลือก): สำหรับเก็บรูปภาพสินค้า สลิปโอนเงิน และใบเสร็จค่าใช้จ่าย
- **NPM Packages (`package.json`)**:
  - `pg` (`^8.20.0`) — เชื่อมต่อฐานข้อมูล PostgreSQL
  - `minio` (`^8.0.7`) — เชื่อมต่อ MinIO Object Storage
- **Frontend Libraries (Self-hosted ในโปรเจกต์ ไม่ต้องพึ่งพา CDN ภายนอก)**:
  - `leaflet/` — แผนที่อินเทอร์แอคทีฟ OpenStreetMap + Leaflet
  - `banks/` — โลโก้ธนาคารในประเทศไทยครบ 21 แห่ง (`.webp` และ `.png`)
  - `data/thailand_geo.json` — ข้อมูล 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมรหัสไปรษณีย์และพิกัด GPS

---

## 5. Usage Example (ตัวอย่างการรันและการใช้งานจริง)

### 5.1 การรันระบบบนเครื่องหรือเซิร์ฟเวอร์

```bash
# 1. โคลนโปรเจกต์และติดตั้งไลบรารี
git clone https://github.com/jaturapornchai/mysmebox.git
cd mysmebox
npm install

# 2. ตั้งค่าไฟล์ .env
cp .env.example .env

# 3. เริ่มต้นเซิร์ฟเวอร์ (พอร์ตเริ่มต้น 3850)
npm start
```

### 5.2 ตัวอย่างการเรียกใช้งาน API ข้อมูลกลาง (ธนาคาร & พิกัดตำบลไทย)

```bash
# ดึงรายชื่อธนาคารในไทยทั้งหมดพร้อมโลโก้
curl -s http://localhost:3850/api/master/banks

# ค้นหาตำบล/อำเภอ/จังหวัด หรือรหัสไปรษณีย์ พร้อมพิกัด GPS อัตโนมัติ
curl -s "http://localhost:3850/api/master/address-search?q=ลาดพร้าว"
```

### 5.3 การเชื่อมต่อกับ AI ตัวอื่นผ่าน MCP (Model Context Protocol)

สามารถเชื่อมผ่าน HTTP JSON-RPC 2.0 (`POST /api/mcp`) หรือตั้งค่าใน **Claude Desktop / Cursor / Windsurf / Antigravity (`mcp_config.json`)** เพื่อใช้ `mcp-server.js` ได้ทันที:

```json
{
  "mcpServers": {
    "mysmebox": {
      "command": "node",
      "args": ["/path/to/mysmebox/mcp-server.js"],
      "env": {
        "MYSMEBOX_API_URL": "https://www.mysmebox.com/api/mcp",
        "MYSMEBOX_USER_EMAIL": "owner.mysmebox@gmail.com"
      }
    }
  }
}
```

**รายการ MCP Tools ที่รองรับ (`tools/list` & `tools/call`)**:
- `mysmebox_get_overview` — ดูสรุปยอดขาย กำไรสุทธิ เงินสดในมือ และภาพรวมทุกร้านค้าในเครือ (Multi-Shop)
- `mysmebox_list_products` — ดูรายการสินค้า หน่วยนับ (ขวด/แพ็ค/ลัง) บาร์โค้ด และยอดคงเหลือหน่วยฐาน
- `mysmebox_lookup_thai_master` — ค้นหา 21 ธนาคารไทย และ 77 จังหวัด 928 อำเภอ 7,436 ตำบล พร้อมรหัสไปรษณีย์และพิกัด GPS (`lat`, `lng`)
- `mysmebox_list_map_locations` — ดูหมุดแผนที่โกดัง ลูกค้าประจำ และจุดจัดส่งพัสดุ
- `mysmebox_create_bill` — สั่งเปิดบิลขายออนไลน์ ตัดสต๊อกตามหน่วยนับ และปักหมุดแผนที่จัดส่งอัตโนมัติ

---

## 6. Limitation (ข้อจำกัดของระบบ)

1. การสร้าง QR Code พร้อมเพย์บนหน้าใบแจ้งหนี้เป็นการจำลองรหัสการชำระเงินเบื้องต้นสำหรับส่งให้ลูกค้าในแชท หากต้องการตรวจสอบสลิปธนาคารอัตโนมัติผ่าน API ธนาคารโดยตรง ต้องเชื่อมต่อ Open Banking API ของแต่ละธนาคารเพิ่มเติม
2. การค้นหาสถานที่แบบละเอียดระดับชื่ออาคารผ่าน OpenStreetMap Nominatim ใช้บริการสาธารณะฟรี จึงเหมาะกับการค้นหาทั่วไปควบคู่กับฐานข้อมูลพิกัด 7,436 ตำบลในระบบกลางของ MySMEBox
3. โหมดทดลองเล่น DEMO ใช้ข้อมูลสาธารณะร่วมกันเพื่อให้ผู้เยี่ยมชมทดลองกดเล่นได้ทันทีโดยไม่ต้องล็อกอิน หากต้องการแยกข้อมูลส่วนตัวของแต่ละร้านค้า ให้เข้าสู่ระบบด้วยอีเมล Gmail ของตนเอง

---

## License

เผยแพร่ภายใต้สัญญาอนุญาต **MIT License** — เปิดให้ผู้ประกอบการ SME ไทย แม่ค้าออนไลน์ และนักพัฒนา นำไปใช้งานและต่อยอดได้อย่างอิสระ
