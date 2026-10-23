# MySMEBox — Open Source ระบบขายของออนไลน์ & สต๊อกหลายหน่วยนับ (Production v1)

> แพลตฟอร์มบริหารออเดอร์ สต๊อกหลายหน่วยนับ บาร์โค้ด ใบปะหน้ากล่อง แผนที่จัดส่ง และผู้ช่วย AI สำหรับแม่ค้าออนไลน์และ SME ไทย  
> ใช้งานจริง: **[https://www.mysmebox.com](https://www.mysmebox.com)** · GitHub: **[https://github.com/jaturapornchai/mysmebox](https://github.com/jaturapornchai/mysmebox)**

---

## 1. Objective (วัตถุประสงค์ของระบบ)

**MySMEBox v1** ออกแบบใหม่ทั้งหมดเพื่อใช้งานจริงระดับ Production โดยเน้นความเรียบง่าย ปลอดภัย และรวดเร็วบนมือถือและคอมพิวเตอร์:

1. **แยกหน้าแนะนำเว็บไซต์ (`/`) และตัวโปรแกรม (`/app/`) ชัดเจน**:
   - หน้าแรก (`/`) เป็นหน้าแนะนำสำหรับผู้มาเยือนและ SEO/AI Search พร้อมปุ่ม **"ทดลองใช้ฟรี ไม่ต้องสมัคร"** และ **"เข้าสู่ระบบด้วย Google"**
   - ตัวโปรแกรม (`/app/`) มีเมนูหลักเพียง 5 เมนู (**หน้าหลัก · ออเดอร์ · สินค้า · แผนที่ · ตั้งค่า**) พร้อมปุ่มลอย **＋ เปิดออเดอร์** และ **ผู้ช่วย AI**
2. **โหมดทดลองเล่น DEMO แยกส่วนตัวต่อผู้ใช้ (Isolated 24-Hour Sandbox)**:
   - เมื่อกดทดลองใช้ฟรี ระบบสร้างร้านค้าตัวอย่างชุดใหม่แยกเฉพาะผู้ใช้นั้น (มีอายุ 24 ชั่วโมงและล้างอัตโนมัติ) ลองเพิ่มสินค้า เปิดออเดอร์ ตัดสต๊อก หรือยกเลิกบิลได้จริงโดยไม่กระทบคนอื่น
3. **เข้าสู่ระบบด้วย Google ของจริง (Google Identity Services + HttpOnly Session Cookie)**:
   - ตรวจสอบ Google ID Token (`aud`, `iss`, `email_verified`, `exp`) ที่ฝั่งเซิร์ฟเวอร์ และเก็บ Session ด้วย SHA-256 Hash ในฐานข้อมูล PostgreSQL (`sessions`)
4. **สินค้าหลายหน่วยนับ & บาร์โค้ดตามหน่วยนับ (`products` & `barcodes`)**:
   - สินค้าเก็บสต๊อกที่หน่วยเล็กสุด (`stock_base`) และตั้งหน่วยใหญ่ (เช่น แพ็ค 3, ลัง 24) ผูกบาร์โค้ดและราคาขายแยกตามหน่วย พร้อมสร้างรหัส EAN-13 อัตโนมัติ และบันทึกประวัติความเคลื่อนไหวสต๊อกแบบ Append-Only (`stock_movements`)
5. **เปิดออเดอร์ไว · QR พร้อมเพย์มาตรฐาน EMVCo · ใบปะหน้ากล่อง 100×150 มม.**:
   - วางข้อความแชทลูกค้าให้ **ผู้ช่วย AI (Ollama Cloud)** แกะเป็นออเดอร์อัตโนมัติ หรือยิงบาร์โค้ดเข้าตะกร้า
   - เลือกที่อยู่จากฐานข้อมูลกลาง **77 จังหวัด · 928 อำเภอ · 7,436 ตำบล** เติมรหัสไปรษณีย์และพิกัด GPS อัตโนมัติ
   - สร้าง **QR พร้อมเพย์ (EMVCo + CRC16)** ตามยอดบิลจริง และพิมพ์ใบปะหน้าพัสดุพร้อมป้ายเก็บเงินปลายทาง (COD)
6. **แผนที่ลูกค้า โกดัง และจุดส่งพัสดุฟรี (OpenStreetMap + Leaflet)**:
   - แสดงหมุดแยกสีระหว่างลูกค้าประจำ โกดังเก็บของ และออเดอร์ที่กำลังจัดส่งหรือรอเก็บเงิน COD
7. **ความแม่นยำทางการเงินระดับบัญชี (BigInt Satang Accounting)**:
   - คำนวณเงินทุกชนิดด้วยหน่วยย่อย **สตางค์ (`BigInt` / PostgreSQL `BIGINT`)** ปราศจากความคลาดเคลื่อนของ Binary Float

---

## 2. Workflow (ขั้นตอนการทำงานหลัก)

```mermaid
flowchart LR
    A["หน้าแรก / กดทดลองใช้ฟรี หรือ Google Login"] --> B["/app/ หน้าหลัก: ดูยอดวันนี้ · รอโอน · รอ COD · ของใกล้หมด"]
    B --> C["เปิดออเดอร์: วางแชทให้ AI กรอก หรือยิงบาร์โค้ดตามหน่วยขาย"]
    C --> D["ตัดสต๊อกหน่วยฐานใน Transaction + บันทึก stock_movements"]
    D --> E["ส่ง QR พร้อมเพย์ / พิมพ์ใบปะหน้า 100x150 มม. / อัปเดตเลขพัสดุ"]
    E --> F["กดรับเงินแล้ว หรือยกเลิกบิล (คืนสต๊อกอัตโนมัติ)"]
```

---

## 3. Config (การตั้งค่าสภาพแวดล้อม `.env`)

คัดลอกไฟล์ `.env.example` เป็น `.env` แล้วตั้งค่าตามเซิร์ฟเวอร์ (ห้ามนำไฟล์ `.env` จริงขึ้น Git):

```ini
PORT=3850
HOST=127.0.0.1
NODE_ENV=production
APP_ORIGIN=https://www.mysmebox.com
COOKIE_SECURE=true
SERVE_STATIC=1

# PostgreSQL Database
DATABASE_URL=postgres://postgres:your_password_here@127.0.0.1:5432/mysmebox # pragma: allowlist secret

# Google OAuth 2.0 Client ID (Web Application)
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com

# Ollama Cloud AI
OLLAMA_API_URL=https://ollama.com/api/chat
OLLAMA_API_KEY=your_ollama_api_key_here # pragma: allowlist secret
OLLAMA_MODEL=gpt-oss:120b

# MinIO Object Storage (ทางเลือกสำหรับอัปโหลดรูปสินค้าและสลิป)
MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9100
MINIO_BUCKET=mysmebox
MINIO_ACCESS_KEY=your_minio_access_key_here # pragma: allowlist secret
MINIO_SECRET_KEY=your_minio_secret_key_here # pragma: allowlist secret
MINIO_USE_SSL=false
```

### วิธีสร้าง Google OAuth Client ID สำหรับใช้งานจริง
1. ไปที่ [Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials)
2. กด **Create Credentials → OAuth client ID** เลือกชนิด **Web application**
3. ในช่อง **Authorized JavaScript origins** เพิ่ม `https://www.mysmebox.com` และ `https://mysmebox.com`
4. คัดลอก **Client ID** มาใส่ใน `.env` ที่ตัวแปร `GOOGLE_CLIENT_ID` แล้วรีสตาร์ทเซิร์ฟเวอร์

---

## 4. Dependency (สิ่งที่ต้องติดตั้ง)

- **Node.js**: เวอร์ชัน `20.0.0` ขึ้นไป
- **PostgreSQL**: เวอร์ชัน `14` ขึ้นไป (ระบบรัน `src/schema.sql` สร้างตารางให้อัตโนมัติเมื่อสตาร์ท)
- **NPM Packages (`package.json`)**:
  - `pg` — เชื่อมต่อฐานข้อมูล PostgreSQL
  - `qrcode` — สร้างรูป QR พร้อมเพย์มาตรฐาน EMVCo (SVG)
  - `minio` — เชื่อมต่อ MinIO Object Storage

---

## 5. Usage Example (ตัวอย่างการรันและทดสอบ)

```bash
# 1. ติดตั้งแพ็กเกจ
npm install

# 2. รันชุดทดสอบ Unit + API Integration (31 tests)
npm test

# 3. เริ่มต้นเซิร์ฟเวอร์
npm start
```

ดูรายละเอียดโครงสร้าง API ทั้งหมดได้ที่ [`docs/api.md`](docs/api.md) และโครงสร้างตารางฐานข้อมูลที่ [`src/schema.sql`](src/schema.sql)

---

## 6. Limitation (ข้อจำกัดในรุ่น v1)

1. รุ่น v1 เน้นระบบหลักสำหรับขายของออนไลน์ (สินค้าหลายหน่วยนับ, บาร์โค้ด, เปิดออเดอร์, QR พร้อมเพย์, ใบปะหน้า, แผนที่ และผู้ช่วย AI) โดยในรุ่นนี้ 1 บัญชีดูแล 1 ร้านค้าหลัก
2. QR พร้อมเพย์สร้างรหัสตามมาตรฐาน EMVCo สำหรับให้ลูกค้าสแกนโอนเงินเข้าบัญชีร้านโดยตรง การยืนยันรับเงินเป็นการกดยืนยันพร้อมแนบสลิปโดยเจ้าของร้าน
3. ร้านค้าทดลอง (DEMO) มีอายุ 24 ชั่วโมงนับจากเวลาที่กดเริ่มทดลอง หากต้องการเก็บข้อมูลถาวรต้องเข้าสู่ระบบด้วยบัญชี Google

---

## License

เผยแพร่ภายใต้สัญญาอนุญาต **MIT License**
