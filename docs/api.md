# MySMEBox v1 — API Contract

ทุก endpoint อยู่ใต้ `/api` ตอบ JSON `Content-Type: application/json; charset=utf-8`

## กติการ่วม

- **สำเร็จ**: `{ "ok": true, ...data }` · **ผิดพลาด**: `{ "ok": false, "error": "ข้อความภาษาไทยที่ผู้ใช้อ่านเข้าใจ", "code": "VALIDATION|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|CONFLICT|RATE_LIMIT|INTERNAL" }`
  - HTTP status: 400 VALIDATION, 401 UNAUTHORIZED, 403 FORBIDDEN, 404 NOT_FOUND, 409 CONFLICT, 429 RATE_LIMIT, 500 INTERNAL
- **เงิน**: ทุกฟิลด์ `*Satang` เป็น **string ตัวเลขจำนวนเต็ม** หน่วยสตางค์ เช่น `"29000"` = 290.00 บาท (ทั้งขาเข้าและขาออก) ห้ามส่ง number
- **จำนวน (qty / stock)**: number จำนวนเต็ม
- **วันเวลา**: ISO 8601 UTC string (`"2026-10-23T00:24:11.000Z"`); หน้าจอแปลงเป็นเวลาไทยเอง
- **Auth**: cookie `sid` (HttpOnly, Secure บน production, SameSite=Lax, อายุ 30 วัน; DEMO = ถึง `expires_at`)
  - endpoint ที่ต้อง login แต่ไม่มี session → 401
  - ร้านของผู้ใช้ = ร้านแรกที่เป็นสมาชิก (`shop_members`) — v1 มีร้านเดียวต่อผู้ใช้ ทุก query กรอง `shop_id` ของผู้ใช้เสมอ
  - ผู้ใช้ login แล้วแต่ยังไม่มีร้าน → endpoint ข้อมูลร้านตอบ 409 `code: "NO_SHOP"` (หน้าจอพาไปตั้งชื่อร้าน)
- **คำขอที่เปลี่ยนข้อมูล** (POST/PUT/DELETE): ต้อง `Content-Type: application/json`; ถ้ามี header `Origin` ต้องตรงกับ `APP_ORIGIN` (env, ค่าเริ่มต้นยอมทุก origin ใน dev) ไม่ตรง → 403
- body ไม่เกิน 1 MB (ยกเว้น `/api/upload` 7 MB)
- ID ทุกตัวส่งเป็น **string** (BIGSERIAL)

### Object shapes

```jsonc
// Product
{
  "id": "12", "code": "P0001", "name": "เซรั่มวิตามินซี 30ml",
  "baseUnitCode": "BTL", "baseUnitName": "ขวด",
  "costBaseSatang": "12000", "stockBase": 48, "minStockBase": 10, "isLowStock": false,
  "imageUrl": "", "isActive": true,
  "units": [ // = unit_conversions_json + ratio + matchedBarcodes
    { "unitCode": "BTL", "unitName": "ขวด", "standValue": 1, "divideValue": 1, "ratio": 1, "availableQty": 48, "matchedBarcodes": ["2001234567890"] },
    { "unitCode": "PK3", "unitName": "แพ็ค 3 ขวด", "standValue": 3, "divideValue": 1, "ratio": 3, "availableQty": 16, "matchedBarcodes": ["2009876543210"] }
  ],
  "barcodes": [
    { "id": "5", "barcode": "2001234567890", "unitCode": "BTL", "priceSatang": "29000", "priceMemberSatang": "27000", "priceWholesaleSatang": "25000" }
  ],
  "createdAt": "...", "updatedAt": "..."
}

// Address block (ใช้ซ้ำใน shop / customer / warehouse)
{ "addressLine": "88/9 ซ.ลาดพร้าว 15", "provinceCode": "10", "provinceName": "กรุงเทพมหานคร",
  "districtCode": "1030", "districtName": "จตุจักร", "subdistrictCode": "103003", "subdistrictName": "จอมพล",
  "zipCode": "10900", "lat": 13.81, "lng": 100.57 }   // lat/lng เป็น number หรือ null

// Customer  = { id, name, phone, note, ...Address, createdAt }
// Warehouse = { id, name, phone, ...Address, createdAt }

// Order (bill)
{
  "id": "33", "billNo": "INV-2610-0001",
  "customerId": "4", "customerName": "คุณแนน", "customerPhone": "0819992233",
  "ship": { "addressLine": "...", "province": "กรุงเทพมหานคร", "district": "จตุจักร", "subdistrict": "จอมพล", "zip": "10900", "lat": 13.81, "lng": 100.57 },
  "channel": "FACEBOOK", "courier": "FLASH", "trackingNo": "",
  "itemsTotalSatang": "58000", "discountSatang": "0", "shippingSatang": "4000",
  "vatRateBp": 0, "vatSatang": "0", "totalSatang": "62000", "costSatang": "24000", "profitSatang": "34000",
  "payMethod": "COD", "payStatus": "UNPAID", "paidAt": null, "payBankCode": "", "slipUrl": "",
  "shipStatus": "PENDING", "status": "ACTIVE", "cancelReason": "", "note": "",
  "items": [
    { "productId": "12", "productName": "เซรั่มวิตามินซี 30ml", "barcode": "2001234567890", "unitCode": "BTL", "unitName": "ขวด",
      "qty": 2, "qtyBase": 2, "priceSatang": "29000", "lineTotalSatang": "58000" }
  ],
  "createdAt": "..."
}
// รายการ (list) ส่ง Order แบบไม่มี items แต่มี "itemCount": number
```

### สูตรคำนวณออเดอร์ (server เป็นผู้คำนวณเท่านั้น; client แสดงตัวอย่างด้วยสูตรเดียวกันแบบ BigInt)

```
qtyBase       = qty * standValue / divideValue          (ต้องหารลงตัว ไม่ลงตัว → 400)
lineTotal     = priceSatang * qty
lineCost      = round_half_up(costBaseSatang * qtyBase)  (เป็นจำนวนเต็มอยู่แล้ว)
itemsTotal    = Σ lineTotal
beforeVat     = itemsTotal - discount + shipping         (discount ≤ itemsTotal)
vat           = round_half_up(beforeVat * vatRateBp / 10000)   (vatRateBp จากร้าน ณ เวลาออกบิล)
total         = beforeVat + vat
cost          = Σ lineCost ; profit = itemsTotal - discount - cost
```

---

## Endpoints

### ระบบ / ผู้ใช้

| Method & Path | Auth | Request | Response |
| :--- | :--- | :--- | :--- |
| `GET /api/health` | - | - | `{ok, db: "up"}` |
| `GET /api/config` | - | - | `{ok, googleClientId: string\|null, demoEnabled: true}` |
| `POST /api/auth/google` | - | `{credential}` (Google ID token) | ตั้ง cookie → `{ok, user, shop\|null}` ; token ไม่ผ่าน → 401 |
| `POST /api/auth/logout` | - | `{}` | ลบ session + ล้าง cookie → `{ok}` |
| `GET /api/me` | ✔ | - | `{ok, user: {id,email,name,avatarUrl,isDemo,expiresAt}, shop: Shop\|null}` |
| `POST /api/demo/start` | - | `{}` | สร้าง user DEMO + ร้าน + ข้อมูลตัวอย่าง, ตั้ง cookie → `{ok, user, shop}` ; เกิน 10 ครั้ง/ชม./IP → 429 |

ตรวจ Google ID token: เรียก `https://oauth2.googleapis.com/tokeninfo?id_token=` แล้วตรวจ `aud === GOOGLE_CLIENT_ID`, `iss ∈ {accounts.google.com, https://accounts.google.com}`, `email_verified === "true"`, `exp` ยังไม่หมด; ไม่ตั้ง `GOOGLE_CLIENT_ID` → 503 `code:"GOOGLE_DISABLED"`

### ร้านค้า

| Method & Path | Request | Response |
| :--- | :--- | :--- |
| `POST /api/shop` | `{name}` (สร้างร้านครั้งแรก, ถ้ามีแล้ว → 409) | `{ok, shop}` |
| `GET /api/shop` | - | `{ok, shop}` |
| `PUT /api/shop` | `{name, phone, promptpayId, bankCode, bankAccountNo, bankAccountName, vatRateBp, ...Address}` | `{ok, shop}` |

Shop = `{id, name, phone, promptpayId, bankCode, bankAccountNo, bankAccountName, vatRateBp, ...Address}`
validate: `promptpayId` ว่าง หรือ ตัวเลข 10 หลักขึ้นต้น 0 หรือ 13 หลัก; `bankCode` ต้องอยู่ใน master หรือว่าง; `vatRateBp` 0..10000

### หน้าหลัก

`GET /api/dashboard` →
```jsonc
{ "ok": true,
  "today": { "orderCount": 3, "salesSatang": "...", "profitSatang": "..." },   // บิล ACTIVE ที่สร้างวันนี้ (เวลาไทย)
  "awaitingTransfer": { "count": 1, "amountSatang": "..." },                   // ACTIVE, TRANSFER, UNPAID
  "awaitingCod": { "count": 2, "amountSatang": "..." },                        // ACTIVE, COD, UNPAID
  "toShip": { "count": 4 },                                                    // ACTIVE, ship_status IN (PENDING, PACKED)
  "lowStock": [ { "id","code","name","stockBase","minStockBase","baseUnitName" } ],  // สูงสุด 10
  "recentOrders": [ Order(list) x 8 ] }
```

### สินค้า

| Method & Path | Request | Response |
| :--- | :--- | :--- |
| `GET /api/products?q=&lowStock=1` | ค้นชื่อ/รหัส/บาร์โค้ด | `{ok, products: Product[]}` (เฉพาะ isActive) |
| `GET /api/products/lookup?barcode=` | - | `{ok, product, barcode}` ไม่พบ → 404 |
| `GET /api/products/:id` | - | `{ok, product}` |
| `POST /api/products` | ดู ProductInput | `{ok, product}` |
| `PUT /api/products/:id` | ProductInput (ไม่มี openingStock) | `{ok, product}` |
| `DELETE /api/products/:id` | - | ปิดใช้งาน (is_active=false) → `{ok}` |
| `POST /api/products/:id/stock` | `{type: "RECEIVE"\|"ADJUST", qtyBase: int (RECEIVE > 0, ADJUST ≠ 0), note}` | `{ok, product}` |
| `GET /api/products/:id/movements` | - | `{ok, movements: [{id, qtyBaseDelta, balanceAfter, reason, refBillNo, note, createdAt}]}` ล่าสุด 50 |
| `GET /api/products/next-barcode?prefix=200` | - | `{ok, barcode}` EAN-13 ที่ยังไม่ซ้ำในร้าน (prefix 200 ใช้ภายในร้าน) |

ProductInput:
```jsonc
{ "code": "P0001" /* ว่าง = ออกให้อัตโนมัติ */, "name": "...", "baseUnitCode": "BTL", "baseUnitName": "ขวด",
  "costBaseSatang": "12000", "minStockBase": 10, "openingStock": 48, "imageUrl": "",
  "units": [ { "unitCode": "PK3", "unitName": "แพ็ค 3 ขวด", "standValue": 3, "divideValue": 1 } ], // ไม่ต้องใส่หน่วยฐาน server เติมให้
  "barcodes": [ { "barcode": "2001234567890" /* ว่าง = สร้าง EAN-13 prefix 200 ให้ */, "unitCode": "BTL",
                  "priceSatang": "29000", "priceMemberSatang": "0", "priceWholesaleSatang": "0" } ] }
```
validate: unitCode `^[A-Z0-9_-]{1,20}$` ไม่ซ้ำในสินค้า; standValue/divideValue จำนวนเต็ม 1..100000; barcode `^[0-9A-Za-z-]{4,32}$` ไม่ซ้ำในร้าน (ซ้ำ → 409); barcode.unitCode ต้องมีอยู่ในหน่วยของสินค้า; ต้องมีบาร์โค้ด ≥ 1 อัน; PUT แทนที่ชุด units/barcodes ทั้งหมด (ห้ามลบหน่วยที่ใช้อยู่ในบิลก็ได้ เพราะ bill_items เก็บ snapshot)

### ออเดอร์

| Method & Path | Request | Response |
| :--- | :--- | :--- |
| `GET /api/orders?status=&q=&limit=50&before=` | status: `ALL\|AWAIT_PAY\|TO_SHIP\|SHIPPED\|DONE\|CANCELLED`; q ค้นเลขบิล/ชื่อ/เบอร์/เลขพัสดุ; `before` = id สำหรับเลื่อนหน้า | `{ok, orders: Order(list)[], nextBefore: string\|null}` |
| `GET /api/orders/:id` | - | `{ok, order}` |
| `POST /api/orders` | OrderInput + header `Idempotency-Key` (ถ้าส่งซ้ำ key เดิม → ตอบบิลเดิม 200) | `{ok, order}` ; สต๊อกไม่พอ → 409 พร้อมชื่อสินค้า |
| `POST /api/orders/:id/pay` | `{payBankCode?, slipUrl?}` | pay_status=PAID, paid_at=NOW → `{ok, order}` (ยกเลิกแล้ว → 409) |
| `POST /api/orders/:id/ship` | `{shipStatus: "PACKED"\|"SHIPPED"\|"DELIVERED"\|"RETURNED", courier?, trackingNo?}` | `{ok, order}` |
| `POST /api/orders/:id/cancel` | `{reason}` | status=CANCELLED + คืนสต๊อก (movement CANCEL) → `{ok, order}` ; ยกเลิกซ้ำ → 409 |
| `GET /api/orders/:id/promptpay` | - | `{ok, payload, qrSvg, amountSatang, promptpayId}` ; ร้านยังไม่ตั้งพร้อมเพย์ → 409 |

สถานะตัวกรอง: `AWAIT_PAY` = ACTIVE & UNPAID · `TO_SHIP` = ACTIVE & ship PENDING/PACKED · `SHIPPED` = ACTIVE & SHIPPED · `DONE` = ACTIVE & PAID & DELIVERED · `CANCELLED`

OrderInput:
```jsonc
{ "customerId": "4" /* หรือ null */, "saveCustomer": true /* true + ไม่มี customerId → สร้างลูกค้าใหม่ */,
  "customerName": "คุณแนน", "customerPhone": "0819992233",
  "ship": { "addressLine": "...", "provinceCode": "10", "provinceName": "...", "districtCode": "...", "districtName": "...",
            "subdistrictCode": "...", "subdistrictName": "...", "zipCode": "10900", "lat": 13.81, "lng": 100.57 },
  "channel": "FACEBOOK", "courier": "FLASH",
  "payMethod": "COD", "paid": false /* true = รับเงินแล้ว (TRANSFER/CASH) */, "payBankCode": "", "slipUrl": "",
  "discountSatang": "0", "shippingSatang": "4000", "note": "",
  "items": [ { "barcode": "2001234567890", "qty": 2, "priceSatang": "29000" /* ไม่ส่ง = ราคาปลีกของบาร์โค้ด */ } ] }
```
- บรรทัดสินค้าอ้างด้วย `barcode` (บาร์โค้ดผูกหน่วยนับอยู่แล้ว) ; รายการ 1..100 ; qty 1..100000
- เลขบิล `INV-YYMM-NNNN` (YYMM เวลาไทย, ค.ศ. 2 หลัก) จาก `doc_sequences`
- ทุกอย่างใน transaction เดียว: lock สินค้า `FOR UPDATE` เรียงตาม id → ตรวจสต๊อก → insert bill/items → ลดสต๊อก + movement SALE

### ลูกค้า / โกดัง / แผนที่

| Method & Path | Request | Response |
| :--- | :--- | :--- |
| `GET /api/customers?q=` | ค้นชื่อ/เบอร์ | `{ok, customers}` (สูงสุด 100) |
| `POST /api/customers` · `PUT /api/customers/:id` | `{name, phone, note, ...Address}` | `{ok, customer}` |
| `DELETE /api/customers/:id` | - | `{ok}` |
| `GET /api/warehouses` · `POST` · `PUT /:id` · `DELETE /:id` | `{name, phone, ...Address}` | `{ok, warehouses}` / `{ok, warehouse}` |
| `GET /api/map` | - | `{ok, shop: {name, lat, lng}, customers: Customer[], warehouses: Warehouse[], deliveries: [{id, billNo, customerName, shipStatus, payMethod, payStatus, totalSatang, lat, lng, addressText}]}` deliveries = บิล ACTIVE ที่ ship_status ≠ DELIVERED และมีพิกัด |

### ข้อมูลกลาง (ไม่ต้อง login, cache 1 วัน)

| Method & Path | Response |
| :--- | :--- |
| `GET /api/master/banks` | `{ok, banks: [{code, botCode, nameTh, shortNameTh, nameEn, color, logo}]}` |
| `GET /api/master/provinces` | `{ok, provinces: [{code, th, en, lat, lng}]}` |
| `GET /api/master/geography?province=10` | `{ok, province: {code, th, lat, lng, districts: [{code, th, lat, lng, subdistricts: [{code, th, zipCode, lat, lng}]}]}}` |
| `GET /api/master/address-search?q=` | `{ok, results: [{provinceCode, provinceTh, districtCode, districtTh, subdistrictCode, subdistrictTh, zipCode, lat, lng}]}` สูงสุด 20; q ≥ 2 ตัวอักษร (ตัวเลข = ค้นรหัสไปรษณีย์) |

### AI (Ollama Cloud) — โควตา: ผู้ใช้จริง 200 ครั้ง/วัน, DEMO 20 ครั้ง/วัน (เกิน → 429)

| Method & Path | Request | Response |
| :--- | :--- | :--- |
| `POST /api/ai/parse-order` | `{text}` (≤ 3000 ตัวอักษร) | `{ok, draft: {customerName, customerPhone, addressText, zipCode, channel, courier, payMethod, shippingSatang, items: [{barcode, productName, unitName, qty}], note}}` — server ส่งรายชื่อสินค้า/บาร์โค้ดของร้านให้ AI และกรอง items ให้เหลือเฉพาะบาร์โค้ดที่มีจริง |
| `POST /api/ai/chat` | `{message, history?: [{role, content}] (≤ 10)}` | `{ok, reply}` — system prompt มีสรุปร้าน (ยอดวันนี้, รอโอน/COD, ของใกล้หมด, รายชื่อสินค้า) |

ไม่ตั้ง `OLLAMA_API_KEY` → 503 `code:"AI_DISABLED"`

### อัปโหลด

`POST /api/upload` `{kind: "product"|"slip", contentType: "image/jpeg"|"image/png"|"image/webp", dataBase64}` (≤ 5 MB หลัง decode, ตรวจ magic bytes) → `{ok, url: "/api/files/<shopId>/<kind>/<uuid>.<ext>"}`
`GET /api/files/:shopId/:kind/:name` — ต้อง login และเป็นร้านเดียวกัน; stream จาก MinIO; ไม่มี MinIO → 503
