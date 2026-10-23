-- MySMEBox v1 schema (PostgreSQL 14+)
-- กฎการเงิน: เงินทุกช่องเป็น BIGINT หน่วยสตางค์ (*_satang) ; อัตรา VAT เป็น basis point (700 = 7.00%)
-- กฎสต๊อก: products.stock_base = ยอดหน่วยฐาน ; ทุกการเปลี่ยนแปลงต้องมีแถวใน stock_movements (append-only)

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL DEFAULT '',
  avatar_url    TEXT NOT NULL DEFAULT '',
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at    TIMESTAMPTZ,                       -- ใช้กับผู้ใช้ DEMO เท่านั้น
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_demo_expiry ON users(expires_at) WHERE is_demo;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash    CHAR(64) PRIMARY KEY,              -- sha256 hex ของ cookie sid (ไม่เก็บ token ดิบ)
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS shops (
  id                 BIGSERIAL PRIMARY KEY,
  owner_user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               VARCHAR(160) NOT NULL,
  phone              VARCHAR(32) NOT NULL DEFAULT '',
  promptpay_id       VARCHAR(20) NOT NULL DEFAULT '',  -- เบอร์มือถือ 10 หลัก หรือเลขบัตร/นิติบุคคล 13 หลัก (ตัวเลขล้วน)
  bank_code          VARCHAR(16) NOT NULL DEFAULT '',
  bank_account_no    VARCHAR(32) NOT NULL DEFAULT '',
  bank_account_name  VARCHAR(160) NOT NULL DEFAULT '',
  address_line       TEXT NOT NULL DEFAULT '',
  province_code      VARCHAR(8) NOT NULL DEFAULT '',
  province_name      VARCHAR(80) NOT NULL DEFAULT '',
  district_code      VARCHAR(8) NOT NULL DEFAULT '',
  district_name      VARCHAR(80) NOT NULL DEFAULT '',
  subdistrict_code   VARCHAR(8) NOT NULL DEFAULT '',
  subdistrict_name   VARCHAR(80) NOT NULL DEFAULT '',
  zip_code           VARCHAR(8) NOT NULL DEFAULT '',
  lat                NUMERIC(9,6),
  lng                NUMERIC(9,6),
  vat_rate_bp        INT NOT NULL DEFAULT 0 CHECK (vat_rate_bp BETWEEN 0 AND 10000),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shops_owner ON shops(owner_user_id);

CREATE TABLE IF NOT EXISTS shop_members (
  shop_id     BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','MANAGER','STAFF')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (shop_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_members_user ON shop_members(user_id);

-- สินค้าเป็นเจ้าของสต๊อกและโครงสร้างหน่วยนับ (AGENTS.md §2)
-- unit_conversions_json: [{ "unitCode":"PK3", "unitName":"แพ็ค 3 ขวด", "standValue":3, "divideValue":1 }]
--   ต้องมีหน่วยฐานเสมอ (unitCode = base_unit_code, standValue = 1, divideValue = 1)
--   จำนวนหน่วยฐาน = qty * standValue / divideValue (ต้องหารลงตัว)
CREATE TABLE IF NOT EXISTS products (
  id                     BIGSERIAL PRIMARY KEY,
  shop_id                BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code                   VARCHAR(40) NOT NULL,
  name                   VARCHAR(200) NOT NULL,
  base_unit_code         VARCHAR(20) NOT NULL,
  base_unit_name         VARCHAR(40) NOT NULL,
  cost_base_satang       BIGINT NOT NULL DEFAULT 0 CHECK (cost_base_satang >= 0),
  stock_base             BIGINT NOT NULL DEFAULT 0,
  min_stock_base         BIGINT NOT NULL DEFAULT 0 CHECK (min_stock_base >= 0),
  unit_conversions_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_url              TEXT NOT NULL DEFAULT '',
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, code)
);
CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop_id, is_active);

-- บาร์โค้ดอ้างอิงหน่วยนับของสินค้า + ราคาตามหน่วยนับ (ไม่เก็บสต๊อก/อัตราส่วนซ้ำ)
CREATE TABLE IF NOT EXISTS barcodes (
  id                      BIGSERIAL PRIMARY KEY,
  shop_id                 BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id              BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode                 VARCHAR(32) NOT NULL,
  unit_code               VARCHAR(20) NOT NULL,
  price_satang            BIGINT NOT NULL CHECK (price_satang >= 0),
  price_member_satang     BIGINT NOT NULL DEFAULT 0 CHECK (price_member_satang >= 0),
  price_wholesale_satang  BIGINT NOT NULL DEFAULT 0 CHECK (price_wholesale_satang >= 0),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, barcode)
);
CREATE INDEX IF NOT EXISTS idx_barcodes_product ON barcodes(product_id);

CREATE TABLE IF NOT EXISTS customers (
  id                BIGSERIAL PRIMARY KEY,
  shop_id           BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name              VARCHAR(160) NOT NULL,
  phone             VARCHAR(32) NOT NULL DEFAULT '',
  address_line      TEXT NOT NULL DEFAULT '',
  province_code     VARCHAR(8) NOT NULL DEFAULT '',
  province_name     VARCHAR(80) NOT NULL DEFAULT '',
  district_code     VARCHAR(8) NOT NULL DEFAULT '',
  district_name     VARCHAR(80) NOT NULL DEFAULT '',
  subdistrict_code  VARCHAR(8) NOT NULL DEFAULT '',
  subdistrict_name  VARCHAR(80) NOT NULL DEFAULT '',
  zip_code          VARCHAR(8) NOT NULL DEFAULT '',
  lat               NUMERIC(9,6),
  lng               NUMERIC(9,6),
  note              TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_shop ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(shop_id, phone);

CREATE TABLE IF NOT EXISTS warehouses (
  id                BIGSERIAL PRIMARY KEY,
  shop_id           BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name              VARCHAR(160) NOT NULL,
  phone             VARCHAR(32) NOT NULL DEFAULT '',
  address_line      TEXT NOT NULL DEFAULT '',
  province_code     VARCHAR(8) NOT NULL DEFAULT '',
  province_name     VARCHAR(80) NOT NULL DEFAULT '',
  district_code     VARCHAR(8) NOT NULL DEFAULT '',
  district_name     VARCHAR(80) NOT NULL DEFAULT '',
  subdistrict_code  VARCHAR(8) NOT NULL DEFAULT '',
  subdistrict_name  VARCHAR(80) NOT NULL DEFAULT '',
  zip_code          VARCHAR(8) NOT NULL DEFAULT '',
  lat               NUMERIC(9,6),
  lng               NUMERIC(9,6),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warehouses_shop ON warehouses(shop_id);

-- เลขเอกสารต่อร้าน/ประเภท/งวด (กันเลขชนด้วย UPDATE ... RETURNING ใน transaction)
CREATE TABLE IF NOT EXISTS doc_sequences (
  shop_id   BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  doc_type  VARCHAR(10) NOT NULL,
  period    CHAR(4) NOT NULL,                      -- YYMM (เวลาไทย)
  last_no   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, doc_type, period)
);

CREATE TABLE IF NOT EXISTS bills (
  id                 BIGSERIAL PRIMARY KEY,
  shop_id            BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  bill_no            VARCHAR(24) NOT NULL,
  customer_id        BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  customer_name      VARCHAR(160) NOT NULL,
  customer_phone     VARCHAR(32) NOT NULL DEFAULT '',
  ship_address_line  TEXT NOT NULL DEFAULT '',
  ship_province      VARCHAR(80) NOT NULL DEFAULT '',
  ship_district      VARCHAR(80) NOT NULL DEFAULT '',
  ship_subdistrict   VARCHAR(80) NOT NULL DEFAULT '',
  ship_zip           VARCHAR(8) NOT NULL DEFAULT '',
  ship_lat           NUMERIC(9,6),
  ship_lng           NUMERIC(9,6),
  channel            VARCHAR(20) NOT NULL DEFAULT 'OTHER'
                     CHECK (channel IN ('FACEBOOK','LINE','TIKTOK','SHOPEE','LAZADA','STORE','OTHER')),
  courier            VARCHAR(20) NOT NULL DEFAULT 'NONE'
                     CHECK (courier IN ('FLASH','KERRY','JT','THAIPOST','SPX','LALAMOVE','PICKUP','NONE')),
  tracking_no        VARCHAR(40) NOT NULL DEFAULT '',
  items_total_satang BIGINT NOT NULL,              -- ผลรวมรายการสินค้า
  discount_satang    BIGINT NOT NULL DEFAULT 0 CHECK (discount_satang >= 0),
  shipping_satang    BIGINT NOT NULL DEFAULT 0 CHECK (shipping_satang >= 0),
  vat_rate_bp        INT NOT NULL DEFAULT 0,
  vat_satang         BIGINT NOT NULL DEFAULT 0,    -- VAT แยกนอก (ยอดก่อน VAT = items - discount + shipping)
  total_satang       BIGINT NOT NULL,              -- ยอดที่ลูกค้าต้องจ่าย
  cost_satang        BIGINT NOT NULL DEFAULT 0,    -- ต้นทุนสินค้าตามหน่วยฐาน
  pay_method         VARCHAR(10) NOT NULL CHECK (pay_method IN ('TRANSFER','COD','CASH')),
  pay_status         VARCHAR(10) NOT NULL DEFAULT 'UNPAID' CHECK (pay_status IN ('UNPAID','PAID')),
  paid_at            TIMESTAMPTZ,
  pay_bank_code      VARCHAR(16) NOT NULL DEFAULT '',
  slip_url           TEXT NOT NULL DEFAULT '',
  ship_status        VARCHAR(10) NOT NULL DEFAULT 'PENDING'
                     CHECK (ship_status IN ('PENDING','PACKED','SHIPPED','DELIVERED','RETURNED')),
  status             VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT NOT NULL DEFAULT '',
  note               TEXT NOT NULL DEFAULT '',
  idempotency_key    VARCHAR(64),
  created_by         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, bill_no),
  UNIQUE (shop_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_bills_shop_created ON bills(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_shop_status ON bills(shop_id, status, pay_status, ship_status);

CREATE TABLE IF NOT EXISTS bill_items (
  id                BIGSERIAL PRIMARY KEY,
  bill_id           BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  product_id        BIGINT REFERENCES products(id) ON DELETE SET NULL,
  product_name      VARCHAR(200) NOT NULL,
  barcode           VARCHAR(32) NOT NULL DEFAULT '',
  unit_code         VARCHAR(20) NOT NULL,
  unit_name         VARCHAR(40) NOT NULL,
  stand_value       INT NOT NULL,
  divide_value      INT NOT NULL,
  qty               INT NOT NULL CHECK (qty > 0),
  qty_base          BIGINT NOT NULL,
  price_satang      BIGINT NOT NULL,               -- ราคาต่อหน่วยที่ขาย
  cost_satang       BIGINT NOT NULL,               -- ต้นทุนรวมของบรรทัด
  line_total_satang BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill ON bill_items(bill_id);

-- append-only: ห้าม UPDATE/DELETE (แก้ด้วยแถวกลับรายการ)
CREATE TABLE IF NOT EXISTS stock_movements (
  id              BIGSERIAL PRIMARY KEY,
  shop_id         BIGINT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id      BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_base_delta  BIGINT NOT NULL,
  balance_after   BIGINT NOT NULL,
  reason          VARCHAR(10) NOT NULL CHECK (reason IN ('OPENING','RECEIVE','ADJUST','SALE','CANCEL')),
  ref_bill_id     BIGINT REFERENCES bills(id) ON DELETE SET NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at DESC);

-- โควตาเรียก AI ต่อผู้ใช้ต่อวัน
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  calls      INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);
