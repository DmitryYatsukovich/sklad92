import { Router } from 'express';
import pool from '../db/pool.js';
import { requireAuth, loadUser, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { SETTINGS_ACCESS_KEYS } from '../lib/app-permissions.js';

const CATALOG_READ_PERMS = ['can_warehouse', ...SETTINGS_ACCESS_KEYS];
const READ_OBJECTS = ['can_settings_work', 'can_settings_warehouses'];
const WORK_LOCATION_KINDS = ['apartment', 'room', 'transit', 'stairwell'];
const RANGE_LOCATION_META = {
  transit: {
    table: 'work_transits',
    alias: 't',
    duplicateMessage: 'Такой транзит уже есть в этом подъезде',
    missingRefMessage: 'Проверьте объект, подъезд и этажи транзита',
  },
  stairwell: {
    table: 'work_stairwells',
    alias: 's',
    duplicateMessage: 'Такая лестничная клетка уже есть в этом подъезде',
    missingRefMessage: 'Проверьте объект, подъезд и этажи лестничной клетки',
  },
};

const router = Router();

router.use(requireAuth);
router.use(loadUser);

let ensureObjectStatusSchemaPromise = null;

async function ensureObjectStatusSchema() {
  if (!ensureObjectStatusSchemaPromise) {
    ensureObjectStatusSchemaPromise = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS work_transits (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          object_id INTEGER NOT NULL REFERENCES warehouse_objects(id) ON DELETE RESTRICT,
          entrance_id INTEGER NOT NULL REFERENCES work_entrances(id) ON DELETE RESTRICT,
          from_floor_id INTEGER NOT NULL REFERENCES work_floors(id) ON DELETE RESTRICT,
          to_floor_id INTEGER NOT NULL REFERENCES work_floors(id) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (entrance_id, name)
        )`,
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS work_stairwells (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL,
          object_id INTEGER NOT NULL REFERENCES warehouse_objects(id) ON DELETE RESTRICT,
          entrance_id INTEGER NOT NULL REFERENCES work_entrances(id) ON DELETE RESTRICT,
          from_floor_id INTEGER NOT NULL REFERENCES work_floors(id) ON DELETE RESTRICT,
          to_floor_id INTEGER NOT NULL REFERENCES work_floors(id) ON DELETE RESTRICT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (entrance_id, name)
        )`,
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transits_object ON work_transits(object_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transits_entrance ON work_transits(entrance_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transits_from_floor ON work_transits(from_floor_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transits_to_floor ON work_transits(to_floor_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_stairwells_object ON work_stairwells(object_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_stairwells_entrance ON work_stairwells(entrance_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_stairwells_from_floor ON work_stairwells(from_floor_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_stairwells_to_floor ON work_stairwells(to_floor_id)');
      await pool.query(
        `CREATE TABLE IF NOT EXISTS work_transit_cable_lines (
          id SERIAL PRIMARY KEY,
          transit_id INTEGER NOT NULL REFERENCES work_transits(id) ON DELETE CASCADE,
          from_location_system_id INTEGER NOT NULL REFERENCES work_location_systems(id) ON DELETE CASCADE,
          to_location_system_id INTEGER NOT NULL REFERENCES work_location_systems(id) ON DELETE CASCADE,
          name VARCHAR(200) NOT NULL,
          length_m NUMERIC(12,3) NOT NULL CHECK (length_m > 0),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CHECK (from_location_system_id <> to_location_system_id)
        )`,
      );
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transit_cable_lines_transit ON work_transit_cable_lines(transit_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transit_cable_lines_from_slot ON work_transit_cable_lines(from_location_system_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_work_transit_cable_lines_to_slot ON work_transit_cable_lines(to_location_system_id)');
      await pool.query(
        `CREATE TABLE IF NOT EXISTS work_block_statuses (
          id SERIAL PRIMARY KEY,
          name VARCHAR(200) NOT NULL UNIQUE,
          color VARCHAR(16) NOT NULL,
          is_for_production BOOLEAN NOT NULL DEFAULT false,
          counts_as_produced BOOLEAN NOT NULL DEFAULT false,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )`,
      );
      await pool.query(
        'ALTER TABLE work_block_statuses ADD COLUMN IF NOT EXISTS is_for_production BOOLEAN NOT NULL DEFAULT false',
      );
      await pool.query(
        'ALTER TABLE work_block_statuses ADD COLUMN IF NOT EXISTS counts_as_produced BOOLEAN NOT NULL DEFAULT false',
      );
      await pool.query(
        'ALTER TABLE work_location_systems ADD COLUMN IF NOT EXISTS status_id INTEGER REFERENCES work_block_statuses(id) ON DELETE SET NULL',
      );
      await pool.query(
        'ALTER TABLE work_location_systems ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
      );
      await pool.query(
        'ALTER TABLE work_location_systems DROP CONSTRAINT IF EXISTS work_location_systems_location_kind_check',
      );
      await pool.query(
        `ALTER TABLE work_location_systems
         ADD CONSTRAINT work_location_systems_location_kind_check
         CHECK (location_kind IN ('apartment', 'room', 'transit', 'stairwell'))`,
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wls_status ON work_location_systems(status_id)',
      );
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_wls_assigned_user ON work_location_systems(assigned_user_id)',
      );
    })().catch((error) => {
      ensureObjectStatusSchemaPromise = null;
      throw error;
    });
  }
  await ensureObjectStatusSchemaPromise;
}

router.use(async (_req, _res, next) => {
  try {
    await ensureObjectStatusSchema();
    next();
  } catch (error) {
    next(error);
  }
});

function parseId(v) {
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

function getRangeLocationMeta(kind) {
  return RANGE_LOCATION_META[kind] || null;
}

async function loadRangeLocationRow(db, kind, id) {
  const meta = getRangeLocationMeta(kind);
  if (!meta) return null;
  const { table, alias } = meta;
  return (await db.query(
    `SELECT ${alias}.id, ${alias}.name, ${alias}.object_id, o.name AS object_name, ${alias}.entrance_id, e.name AS entrance_name,
            ${alias}.from_floor_id, ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
            ${alias}.to_floor_id, tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order,
            ${alias}.created_at
     FROM ${table} ${alias}
     JOIN work_entrances e ON e.id = ${alias}.entrance_id
     JOIN work_floors ff ON ff.id = ${alias}.from_floor_id
     JOIN work_floors tf ON tf.id = ${alias}.to_floor_id
     LEFT JOIN warehouse_objects o ON o.id = ${alias}.object_id
     WHERE ${alias}.id = $1`,
    [id],
  )).rows[0] || null;
}

function parseOptionalPositiveInt(v) {
  if (v == null || v === '') return undefined;
  const n = parseInt(v, 10);
  return n > 0 ? n : null;
}

function parsePositiveDecimal(v) {
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseCategoryIconKey(value) {
  const raw = (value ?? '').toString().trim();
  if (!raw) return null;
  return raw.slice(0, 64);
}

function parseStatusColor(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return null;
  return raw.toUpperCase();
}

function parseOptionalBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseRequiredName(value, max = 300) {
  const name = String(value ?? '').trim();
  if (!name) return null;
  return name.slice(0, max);
}

function clampSortOrder(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function resequenceEntranceFloors(db, entranceId) {
  if (!entranceId) return;
  await db.query(
    `WITH ranked AS (
       SELECT id, ROW_NUMBER() OVER (
         PARTITION BY entrance_id
         ORDER BY sort_order NULLS LAST, created_at, id
       ) AS rn
       FROM work_floors
       WHERE entrance_id = $1
     )
     UPDATE work_floors wf
     SET sort_order = ranked.rn
     FROM ranked
     WHERE wf.id = ranked.id
       AND (wf.sort_order IS NULL OR wf.sort_order <> ranked.rn)`,
    [entranceId],
  );
}

async function getEntranceFloorsCount(db, entranceId) {
  const countResult = await db.query('SELECT COUNT(*)::int AS total FROM work_floors WHERE entrance_id = $1', [entranceId]);
  return countResult.rows[0]?.total || 0;
}

async function moveFloorWithinEntrance(db, { entranceId, floorId, fromOrder, toOrder }) {
  if (fromOrder === toOrder) return;
  if (toOrder < fromOrder) {
    await db.query(
      `UPDATE work_floors
       SET sort_order = sort_order + 1
       WHERE entrance_id = $1
         AND id <> $2
         AND sort_order >= $3
         AND sort_order < $4`,
      [entranceId, floorId, toOrder, fromOrder],
    );
  } else {
    await db.query(
      `UPDATE work_floors
       SET sort_order = sort_order - 1
       WHERE entrance_id = $1
         AND id <> $2
         AND sort_order <= $3
         AND sort_order > $4`,
      [entranceId, floorId, toOrder, fromOrder],
    );
  }
  await db.query('UPDATE work_floors SET sort_order = $1 WHERE id = $2', [toOrder, floorId]);
}

function floorSortRank(row) {
  const sort = Number(row?.sort_order);
  if (Number.isFinite(sort)) return sort;
  return Number.MAX_SAFE_INTEGER;
}

function normalizeFloorRange(fromFloor, toFloor) {
  if (!fromFloor || !toFloor) return { fromFloor, toFloor };
  const fromRank = floorSortRank(fromFloor);
  const toRank = floorSortRank(toFloor);
  if (fromRank < toRank) return { fromFloor, toFloor };
  if (fromRank > toRank) return { fromFloor: toFloor, toFloor: fromFloor };
  if (Number(fromFloor.id) <= Number(toFloor.id)) return { fromFloor, toFloor };
  return { fromFloor: toFloor, toFloor: fromFloor };
}

async function resolveEntranceFloorRange(db, {
  objectId,
  entranceId,
  fromFloorId,
  toFloorId,
}) {
  const entrance = (await db.query(
    `SELECT e.id, e.object_id, e.name, o.name AS object_name
     FROM work_entrances e
     LEFT JOIN warehouse_objects o ON o.id = e.object_id
     WHERE e.id = $1`,
    [entranceId],
  )).rows[0];
  if (!entrance) return { error: 'Подъезд не найден' };

  if (objectId && Number(entrance.object_id || 0) !== Number(objectId)) {
    return { error: 'Подъезд не относится к выбранному объекту' };
  }

  const floorRows = (await db.query(
    `SELECT id, entrance_id, name, sort_order
     FROM work_floors
     WHERE id = ANY($1::int[])`,
    [[fromFloorId, toFloorId]],
  )).rows;
  if (floorRows.length !== 2) return { error: 'Выберите этажи начала и конца' };
  const floorById = new Map(floorRows.map((row) => [Number(row.id), row]));
  const fromFloorRaw = floorById.get(Number(fromFloorId));
  const toFloorRaw = floorById.get(Number(toFloorId));
  if (!fromFloorRaw || !toFloorRaw) return { error: 'Выберите этажи начала и конца' };
  if (
    Number(fromFloorRaw.entrance_id || 0) !== Number(entrance.id)
    || Number(toFloorRaw.entrance_id || 0) !== Number(entrance.id)
  ) {
    return { error: 'Этажи должны относиться к выбранному подъезду' };
  }
  const { fromFloor, toFloor } = normalizeFloorRange(fromFloorRaw, toFloorRaw);
  return {
    entrance,
    objectId: Number(entrance.object_id),
    fromFloor,
    toFloor,
  };
}

async function loadLocationByKind(db, kind, locationId) {
  if (kind === 'apartment') {
    const row = (await db.query(
      `SELECT a.id, a.name, a.floor_id,
              f.entrance_id, f.name AS floor_name, f.sort_order AS floor_sort_order,
              e.object_id, e.name AS entrance_name
       FROM work_apartments a
       JOIN work_floors f ON f.id = a.floor_id
       JOIN work_entrances e ON e.id = f.entrance_id
       WHERE a.id = $1`,
      [locationId],
    )).rows[0];
    if (!row) return null;
    return {
      kind: 'apartment',
      id: row.id,
      name: row.name,
      apartment_id: row.id,
      room_id: null,
      floor_id: row.floor_id,
      floor_name: row.floor_name,
      floor_sort_order: row.floor_sort_order,
      entrance_id: row.entrance_id,
      entrance_name: row.entrance_name,
      object_id: row.object_id,
    };
  }
  if (kind === 'room') {
    const row = (await db.query(
      `SELECT r.id, r.name, r.apartment_id,
              a.name AS apartment_name, a.floor_id,
              f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id,
              e.object_id, e.name AS entrance_name
       FROM work_rooms r
       JOIN work_apartments a ON a.id = r.apartment_id
       JOIN work_floors f ON f.id = a.floor_id
       JOIN work_entrances e ON e.id = f.entrance_id
       WHERE r.id = $1`,
      [locationId],
    )).rows[0];
    if (!row) return null;
    return {
      kind: 'room',
      id: row.id,
      name: row.name,
      apartment_id: row.apartment_id,
      apartment_name: row.apartment_name,
      room_id: row.id,
      floor_id: row.floor_id,
      floor_name: row.floor_name,
      floor_sort_order: row.floor_sort_order,
      entrance_id: row.entrance_id,
      entrance_name: row.entrance_name,
      object_id: row.object_id,
    };
  }
  if (kind === 'transit') {
    const row = (await db.query(
      `SELECT t.id, t.name, t.object_id, t.entrance_id, t.from_floor_id, t.to_floor_id,
              e.name AS entrance_name,
              ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
              tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order
       FROM work_transits t
       JOIN work_entrances e ON e.id = t.entrance_id
       JOIN work_floors ff ON ff.id = t.from_floor_id
       JOIN work_floors tf ON tf.id = t.to_floor_id
       WHERE t.id = $1`,
      [locationId],
    )).rows[0];
    if (!row) return null;
    return {
      kind: 'transit',
      id: row.id,
      name: row.name,
      object_id: row.object_id,
      entrance_id: row.entrance_id,
      entrance_name: row.entrance_name,
      from_floor_id: row.from_floor_id,
      to_floor_id: row.to_floor_id,
      from_floor_name: row.from_floor_name,
      to_floor_name: row.to_floor_name,
      from_floor_sort_order: row.from_floor_sort_order,
      to_floor_sort_order: row.to_floor_sort_order,
    };
  }
  if (kind === 'stairwell') {
    const row = (await db.query(
      `SELECT s.id, s.name, s.object_id, s.entrance_id, s.from_floor_id, s.to_floor_id,
              e.name AS entrance_name,
              ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
              tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order
       FROM work_stairwells s
       JOIN work_entrances e ON e.id = s.entrance_id
       JOIN work_floors ff ON ff.id = s.from_floor_id
       JOIN work_floors tf ON tf.id = s.to_floor_id
       WHERE s.id = $1`,
      [locationId],
    )).rows[0];
    if (!row) return null;
    return {
      kind: 'stairwell',
      id: row.id,
      name: row.name,
      object_id: row.object_id,
      entrance_id: row.entrance_id,
      entrance_name: row.entrance_name,
      from_floor_id: row.from_floor_id,
      to_floor_id: row.to_floor_id,
      from_floor_name: row.from_floor_name,
      to_floor_name: row.to_floor_name,
      from_floor_sort_order: row.from_floor_sort_order,
      to_floor_sort_order: row.to_floor_sort_order,
    };
  }
  return null;
}

function locationWithinTransitRange(transitLocation, slotLocation) {
  if (!transitLocation || !slotLocation) return false;
  const slotRank = floorSortRank(slotLocation);
  const fromRank = floorSortRank({ sort_order: transitLocation.from_floor_sort_order });
  const toRank = floorSortRank({ sort_order: transitLocation.to_floor_sort_order });
  const minRank = Math.min(fromRank, toRank);
  const maxRank = Math.max(fromRank, toRank);
  return slotRank >= minRank && slotRank <= maxRank;
}

async function loadLocationSystemWithPlacement(db, locationSystemId) {
  const slot = (await db.query(
    `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id,
            s.name AS system_name, c.name AS category_name
     FROM work_location_systems ls
     LEFT JOIN material_systems s ON s.id = ls.system_id
     LEFT JOIN material_categories c ON c.id = ls.category_id
     WHERE ls.id = $1`,
    [locationSystemId],
  )).rows[0];
  if (!slot) return null;
  const location = await loadLocationByKind(db, slot.location_kind, slot.location_id);
  if (!location) return null;
  return {
    ...slot,
    location,
  };
}

function isTransitCableEndpointKind(kind) {
  return kind === 'apartment' || kind === 'room';
}

async function loadTransitCableLineById(db, id) {
  return (await db.query(
    `SELECT id, transit_id, from_location_system_id, to_location_system_id, name, length_m, created_at, updated_at
     FROM work_transit_cable_lines
     WHERE id = $1`,
    [id],
  )).rows[0] || null;
}

async function validateTransitCableLineInput(db, {
  transitId,
  fromLocationSystemId,
  toLocationSystemId,
  name,
  lengthM,
}) {
  const transit = await loadLocationByKind(db, 'transit', transitId);
  if (!transit) return { error: 'Транзит не найден' };

  const [fromSlot, toSlot] = await Promise.all([
    loadLocationSystemWithPlacement(db, fromLocationSystemId),
    loadLocationSystemWithPlacement(db, toLocationSystemId),
  ]);
  if (!fromSlot || !toSlot) return { error: 'Выберите существующие блоки' };
  if (fromSlot.id === toSlot.id) return { error: 'Начальный и конечный блок должны отличаться' };

  if (!isTransitCableEndpointKind(fromSlot.location_kind) || !isTransitCableEndpointKind(toSlot.location_kind)) {
    return { error: 'Кабель можно привязать только к блокам квартир и помещений' };
  }

  const invalidScope = [fromSlot, toSlot].find((slot) => {
    const location = slot.location;
    if (!location) return true;
    if (Number(location.object_id || 0) !== Number(transit.object_id || 0)) return true;
    if (Number(location.entrance_id || 0) !== Number(transit.entrance_id || 0)) return true;
    if (!locationWithinTransitRange(transit, location)) return true;
    return false;
  });
  if (invalidScope) {
    return { error: 'Выберите блоки в том же подъезде и в диапазоне этажей транзита' };
  }

  return {
    transit,
    fromSlot,
    toSlot,
    name,
    lengthM,
  };
}

/** Все справочники для форм склада */
router.get('/catalog', requireAnyPermission(...CATALOG_READ_PERMS), async (_req, res) => {
  try {
    const [
      objects, warehouses, racks, categories, systems, organizations,
      workEntrances, workFloors, workApartments, workRooms, workTransits, workStairwells, toolTypes, blockStatuses,
    ] = await Promise.all([
      pool.query('SELECT id, name FROM warehouse_objects ORDER BY name'),
      pool.query(
        `SELECT w.id, w.name, w.object_id, o.name AS object_name
         FROM warehouses w JOIN warehouse_objects o ON o.id = w.object_id ORDER BY o.name, w.name`
      ),
      pool.query(
        `SELECT r.id, r.name, r.warehouse_id, w.name AS warehouse_name, w.object_id
         FROM warehouse_racks r JOIN warehouses w ON w.id = r.warehouse_id ORDER BY w.name, r.name`
      ),
      pool.query('SELECT id, name, icon_key FROM material_categories ORDER BY name'),
      pool.query('SELECT id, name FROM material_systems ORDER BY name'),
      pool.query('SELECT id, name FROM organizations ORDER BY name'),
      pool.query(
        `SELECT e.id, e.name, e.object_id, o.name AS object_name
         FROM work_entrances e
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name`
      ),
      pool.query(
        `SELECT f.id, f.name, f.entrance_id, f.sort_order, e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_floors f
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name`
      ),
      pool.query(
        `SELECT a.id, a.name, a.floor_id, f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id,
                e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_apartments a
         JOIN work_floors f ON f.id = a.floor_id
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name, a.name`
      ),
      pool.query(
        `SELECT r.id, r.name, r.apartment_id, a.name AS apartment_name,
                a.floor_id, f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id, e.name AS entrance_name,
                e.object_id, o.name AS object_name
         FROM work_rooms r
         JOIN work_apartments a ON a.id = r.apartment_id
         JOIN work_floors f ON f.id = a.floor_id
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name, a.name, r.name`
      ),
      pool.query(
        `SELECT t.id, t.name, t.object_id, o.name AS object_name, t.entrance_id, e.name AS entrance_name,
                t.from_floor_id, ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
                t.to_floor_id, tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order,
                t.created_at
         FROM work_transits t
         JOIN work_entrances e ON e.id = t.entrance_id
         JOIN work_floors ff ON ff.id = t.from_floor_id
         JOIN work_floors tf ON tf.id = t.to_floor_id
         LEFT JOIN warehouse_objects o ON o.id = t.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(ff.sort_order, 2147483647), COALESCE(tf.sort_order, 2147483647), t.name`
      ),
      pool.query(
        `SELECT s.id, s.name, s.object_id, o.name AS object_name, s.entrance_id, e.name AS entrance_name,
                s.from_floor_id, ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
                s.to_floor_id, tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order,
                s.created_at
         FROM work_stairwells s
         JOIN work_entrances e ON e.id = s.entrance_id
         JOIN work_floors ff ON ff.id = s.from_floor_id
         JOIN work_floors tf ON tf.id = s.to_floor_id
         LEFT JOIN warehouse_objects o ON o.id = s.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(ff.sort_order, 2147483647), COALESCE(tf.sort_order, 2147483647), s.name`
      ),
      pool.query('SELECT id, name FROM tool_types ORDER BY name'),
      pool.query('SELECT id, name, color, is_for_production, counts_as_produced, sort_order, created_at, updated_at FROM work_block_statuses ORDER BY sort_order, name'),
    ]);
    res.json({
      objects: objects.rows,
      warehouses: warehouses.rows,
      racks: racks.rows,
      categories: categories.rows,
      systems: systems.rows,
      organizations: organizations.rows,
      work_entrances: workEntrances.rows,
      work_floors: workFloors.rows,
      work_apartments: workApartments.rows,
      work_rooms: workRooms.rows,
      work_transits: workTransits.rows,
      work_stairwells: workStairwells.rows,
      tool_types: toolTypes.rows,
      block_statuses: blockStatuses.rows,
    });
  } catch (e) {
    console.error('GET /settings/catalog:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки справочников' });
  }
});

const ORG_SELECT = `id, name, inn, kpp, ogrn, legal_address, actual_address, phone, email,
  director_name, bank_name, bank_bik, bank_account, bank_corr_account, created_at`;

function trimOrgField(v) {
  const s = (v ?? '').toString().trim();
  return s || null;
}

function parseOrgBody(body) {
  const name = (body?.name || '').trim();
  if (!name) return { error: 'Укажите наименование организации' };
  return {
    name,
    inn: trimOrgField(body.inn),
    kpp: trimOrgField(body.kpp),
    ogrn: trimOrgField(body.ogrn),
    legal_address: trimOrgField(body.legal_address),
    actual_address: trimOrgField(body.actual_address),
    phone: trimOrgField(body.phone),
    email: trimOrgField(body.email),
    director_name: trimOrgField(body.director_name),
    bank_name: trimOrgField(body.bank_name),
    bank_bik: trimOrgField(body.bank_bik),
    bank_account: trimOrgField(body.bank_account),
    bank_corr_account: trimOrgField(body.bank_corr_account),
  };
}

/** Список организаций — для настроек и выбора в карточке пользователя */
router.get('/organizations', requireAnyPermission('can_users', 'can_settings_organizations'), async (_req, res) => {
  try {
    const r = await pool.query(`SELECT ${ORG_SELECT} FROM organizations ORDER BY name`);
    res.json(r.rows);
  } catch (e) {
    console.error('GET /settings/organizations:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки организаций' });
  }
});

// ——— Объекты ———
router.get('/objects', requireAnyPermission(...READ_OBJECTS), async (_req, res) => {
  const r = await pool.query('SELECT id, name, created_at FROM warehouse_objects ORDER BY name');
  res.json(r.rows);
});

router.post('/objects', requirePermission('can_settings_work'), async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название объекта' });
  try {
    const r = await pool.query(
      'INSERT INTO warehouse_objects (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой объект уже есть' });
    throw e;
  }
});

router.put('/objects/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const name = (req.body?.name || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const r = await pool.query(
      'UPDATE warehouse_objects SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name, id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое название уже есть' });
    throw e;
  }
});

router.delete('/objects/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE object_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Объект используется в материалах' });
  const usedEntrances = await pool.query('SELECT 1 FROM work_entrances WHERE object_id = $1 LIMIT 1', [id]);
  if (usedEntrances.rowCount) return res.status(400).json({ error: 'Объект используется в подъездах' });
  const r = await pool.query('DELETE FROM warehouse_objects WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Склады ———
router.get('/warehouses', requirePermission('can_settings_warehouses'), async (req, res) => {
  const objectId = parseId(req.query.object_id);
  const params = [];
  let where = '';
  if (objectId) {
    where = 'WHERE w.object_id = $1';
    params.push(objectId);
  }
  const r = await pool.query(
    `SELECT w.id, w.name, w.object_id, o.name AS object_name, w.created_at
     FROM warehouses w JOIN warehouse_objects o ON o.id = w.object_id
     ${where} ORDER BY o.name, w.name`,
    params
  );
  res.json(r.rows);
});

router.post('/warehouses', requirePermission('can_settings_warehouses'), async (req, res) => {
  const object_id = parseId(req.body?.object_id);
  const name = (req.body?.name || '').trim();
  if (!object_id || !name) return res.status(400).json({ error: 'Укажите объект и название склада' });
  try {
    const r = await pool.query(
      `INSERT INTO warehouses (object_id, name) VALUES ($1, $2)
       RETURNING id, object_id, name, created_at`,
      [object_id, name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой склад уже есть на этом объекте' });
    if (e.code === '23503') return res.status(400).json({ error: 'Объект не найден' });
    throw e;
  }
});

router.put('/warehouses/:id', requirePermission('can_settings_warehouses'), async (req, res) => {
  const id = parseId(req.params.id);
  const object_id = req.body?.object_id != null ? parseId(req.body.object_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT object_id, name FROM warehouses WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const oid = object_id ?? cur.object_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE warehouses SET object_id = $1, name = $2 WHERE id = $3 RETURNING id, object_id, name, created_at',
      [oid, nm, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой склад уже есть на объекте' });
    throw e;
  }
});

router.delete('/warehouses/:id', requirePermission('can_settings_warehouses'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE warehouse_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Склад используется в материалах' });
  const r = await pool.query('DELETE FROM warehouses WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Стеллажи ———
router.get('/racks', requirePermission('can_settings_warehouses'), async (req, res) => {
  const warehouseId = parseId(req.query.warehouse_id);
  const params = [];
  let where = '';
  if (warehouseId) {
    where = 'WHERE r.warehouse_id = $1';
    params.push(warehouseId);
  }
  const r = await pool.query(
    `SELECT r.id, r.name, r.warehouse_id, w.name AS warehouse_name, w.object_id, r.created_at
     FROM warehouse_racks r JOIN warehouses w ON w.id = r.warehouse_id
     ${where} ORDER BY w.name, r.name`,
    params
  );
  res.json(r.rows);
});

router.post('/racks', requirePermission('can_settings_warehouses'), async (req, res) => {
  const warehouse_id = parseId(req.body?.warehouse_id);
  const name = (req.body?.name || '').trim();
  if (!warehouse_id || !name) return res.status(400).json({ error: 'Укажите склад и название стеллажа' });
  try {
    const r = await pool.query(
      `INSERT INTO warehouse_racks (warehouse_id, name) VALUES ($1, $2)
       RETURNING id, warehouse_id, name, created_at`,
      [warehouse_id, name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой стеллаж уже есть на этом складе' });
    if (e.code === '23503') return res.status(400).json({ error: 'Склад не найден' });
    throw e;
  }
});

router.put('/racks/:id', requirePermission('can_settings_warehouses'), async (req, res) => {
  const id = parseId(req.params.id);
  const warehouse_id = req.body?.warehouse_id != null ? parseId(req.body.warehouse_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT warehouse_id, name FROM warehouse_racks WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const wid = warehouse_id ?? cur.warehouse_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE warehouse_racks SET warehouse_id = $1, name = $2 WHERE id = $3 RETURNING id, warehouse_id, name, created_at',
      [wid, nm, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой стеллаж уже есть на складе' });
    throw e;
  }
});

router.delete('/racks/:id', requirePermission('can_settings_warehouses'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE rack_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Стеллаж используется в материалах' });
  const r = await pool.query('DELETE FROM warehouse_racks WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Категории ———
router.get('/categories', requirePermission('can_settings_categories'), async (_req, res) => {
  const r = await pool.query('SELECT id, name, icon_key, created_at FROM material_categories ORDER BY name');
  res.json(r.rows);
});

router.post('/categories', requirePermission('can_settings_categories'), async (req, res) => {
  const name = (req.body?.name || '').trim();
  const iconKey = parseCategoryIconKey(req.body?.icon_key);
  if (!name) return res.status(400).json({ error: 'Укажите название категории' });
  try {
    const r = await pool.query(
      'INSERT INTO material_categories (name, icon_key) VALUES ($1, $2) RETURNING id, name, icon_key, created_at',
      [name, iconKey]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая категория уже есть' });
    throw e;
  }
});

router.put('/categories/:id', requirePermission('can_settings_categories'), async (req, res) => {
  const id = parseId(req.params.id);
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  const iconKey = req.body?.icon_key !== undefined
    ? parseCategoryIconKey(req.body?.icon_key)
    : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT name, icon_key FROM material_categories WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const nextName = name ?? cur.name;
  const nextIconKey = iconKey === undefined ? cur.icon_key : iconKey;
  if (!nextName) return res.status(400).json({ error: 'Укажите название категории' });
  try {
    const r = await pool.query(
      'UPDATE material_categories SET name = $1, icon_key = $2 WHERE id = $3 RETURNING id, name, icon_key, created_at',
      [nextName, nextIconKey, id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое название уже есть' });
    throw e;
  }
});

router.delete('/categories/:id', requirePermission('can_settings_categories'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE category_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Категория используется в материалах' });
  const r = await pool.query('DELETE FROM material_categories WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Системы ———
router.get('/systems', requirePermission('can_settings_categories'), async (_req, res) => {
  const r = await pool.query('SELECT id, name, created_at FROM material_systems ORDER BY name');
  res.json(r.rows);
});

router.post('/systems', requirePermission('can_settings_categories'), async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название системы' });
  try {
    const r = await pool.query(
      'INSERT INTO material_systems (name) VALUES ($1) RETURNING id, name, created_at',
      [name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая система уже есть' });
    throw e;
  }
});

router.put('/systems/:id', requirePermission('can_settings_categories'), async (req, res) => {
  const id = parseId(req.params.id);
  const name = (req.body?.name || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const r = await pool.query(
      'UPDATE material_systems SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name, id],
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое название уже есть' });
    throw e;
  }
});

router.delete('/systems/:id', requirePermission('can_settings_categories'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM materials WHERE system_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Система используется в материалах' });
  const usedInLocations = await pool.query('SELECT 1 FROM work_location_systems WHERE system_id = $1 LIMIT 1', [id]);
  if (usedInLocations.rowCount) return res.status(400).json({ error: 'Система используется в настройках объектов' });
  const r = await pool.query('DELETE FROM material_systems WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Статусы блоков объектов ———
router.get('/object-block-statuses', requirePermission('can_settings_work'), async (_req, res) => {
  const r = await pool.query(
    `SELECT id, name, color, is_for_production, counts_as_produced, sort_order, created_at, updated_at
     FROM work_block_statuses
     ORDER BY sort_order, name`,
  );
  res.json(r.rows);
});

router.post('/object-block-statuses', requirePermission('can_settings_work'), async (req, res) => {
  const name = (req.body?.name || '').trim();
  const color = parseStatusColor(req.body?.color);
  const isForProduction = parseOptionalBoolean(req.body?.is_for_production, false);
  const countsAsProduced = parseOptionalBoolean(req.body?.counts_as_produced, false);
  if (!name) return res.status(400).json({ error: 'Укажите название статуса' });
  if (!color) return res.status(400).json({ error: 'Цвет должен быть в формате #RRGGBB' });
  const rawSortOrder = req.body?.sort_order;
  const sortOrder = rawSortOrder == null || rawSortOrder === ''
    ? 0
    : Number.parseInt(rawSortOrder, 10);
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return res.status(400).json({ error: 'Порядок должен быть целым числом 0 или больше' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO work_block_statuses (name, color, is_for_production, counts_as_produced, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, color, is_for_production, counts_as_produced, sort_order, created_at, updated_at`,
      [name, color, isForProduction, countsAsProduced, sortOrder],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Статус с таким названием уже существует' });
    throw e;
  }
});

router.put('/object-block-statuses/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const current = (await pool.query(
    'SELECT id, name, color, is_for_production, counts_as_produced, sort_order FROM work_block_statuses WHERE id = $1',
    [id],
  )).rows[0];
  if (!current) return res.status(404).json({ error: 'Не найдено' });

  const nextName = req.body?.name !== undefined ? String(req.body?.name || '').trim() : current.name;
  if (!nextName) return res.status(400).json({ error: 'Укажите название статуса' });
  const nextColor = req.body?.color !== undefined ? parseStatusColor(req.body?.color) : current.color;
  if (!nextColor) return res.status(400).json({ error: 'Цвет должен быть в формате #RRGGBB' });
  const nextIsForProduction = parseOptionalBoolean(req.body?.is_for_production, current.is_for_production);
  const nextCountsAsProduced = parseOptionalBoolean(req.body?.counts_as_produced, current.counts_as_produced);

  let nextSortOrder = current.sort_order ?? 0;
  if (req.body?.sort_order !== undefined) {
    const parsedSortOrder = Number.parseInt(req.body?.sort_order, 10);
    if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
      return res.status(400).json({ error: 'Порядок должен быть целым числом 0 или больше' });
    }
    nextSortOrder = parsedSortOrder;
  }

  try {
    const r = await pool.query(
      `UPDATE work_block_statuses
       SET name = $1, color = $2, is_for_production = $3, counts_as_produced = $4, sort_order = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, color, is_for_production, counts_as_produced, sort_order, created_at, updated_at`,
      [nextName, nextColor, nextIsForProduction, nextCountsAsProduced, nextSortOrder, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Статус с таким названием уже существует' });
    throw e;
  }
});

router.delete('/object-block-statuses/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_location_systems WHERE status_id = $1 LIMIT 1', [id]);
  if (used.rowCount) {
    return res.status(400).json({ error: 'Статус используется в блоках объектов и не может быть удалён' });
  }
  const r = await pool.query('DELETE FROM work_block_statuses WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Виды инструмента ———
router.get('/tool-types', requirePermission('can_settings_tools'), async (_req, res) => {
  const r = await pool.query('SELECT id, name, created_at FROM tool_types ORDER BY name');
  res.json(r.rows);
});

router.post('/tool-types', requirePermission('can_settings_tools'), async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Укажите название вида инструмента' });
  try {
    const r = await pool.query(
      'INSERT INTO tool_types (name) VALUES ($1) RETURNING id, name, created_at',
      [name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой вид инструмента уже существует' });
    throw e;
  }
});

router.put('/tool-types/:id', requirePermission('can_settings_tools'), async (req, res) => {
  const id = parseId(req.params.id);
  const name = (req.body?.name || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'Неверные данные' });
  try {
    const r = await pool.query(
      'UPDATE tool_types SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name, id],
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой вид инструмента уже существует' });
    throw e;
  }
});

router.delete('/tool-types/:id', requirePermission('can_settings_tools'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM tools WHERE type_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'Этот вид используется в инструментах' });
  const r = await pool.query('DELETE FROM tool_types WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Место проведения работ: подъезды ———
router.get('/work-entrances', requirePermission('can_settings_work'), async (req, res) => {
  const objectId = parseId(req.query.object_id);
  const params = [];
  let where = '';
  if (objectId) {
    where = 'WHERE e.object_id = $1';
    params.push(objectId);
  }
  const r = await pool.query(
    `SELECT e.id, e.name, e.object_id, o.name AS object_name, e.created_at
     FROM work_entrances e
     LEFT JOIN warehouse_objects o ON o.id = e.object_id
     ${where} ORDER BY o.name NULLS LAST, e.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-entrances', requirePermission('can_settings_work'), async (req, res) => {
  const object_id = parseId(req.body?.object_id);
  const name = (req.body?.name || '').trim();
  if (!object_id || !name) return res.status(400).json({ error: 'Укажите объект и название подъезда' });
  try {
    const r = await pool.query(
      `INSERT INTO work_entrances (object_id, name) VALUES ($1, $2)
       RETURNING id, object_id, name, created_at`,
      [object_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой подъезд уже есть на этом объекте' });
    if (e.code === '23503') return res.status(400).json({ error: 'Объект не найден' });
    throw e;
  }
});

router.put('/work-entrances/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const object_id = req.body?.object_id != null ? parseId(req.body.object_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT object_id, name FROM work_entrances WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const oid = object_id ?? cur.object_id;
  const nm = name ?? cur.name;
  if (!oid || !nm) return res.status(400).json({ error: 'Укажите объект и название' });
  try {
    const r = await pool.query(
      'UPDATE work_entrances SET object_id = $1, name = $2 WHERE id = $3 RETURNING id, object_id, name, created_at',
      [oid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой подъезд уже есть на объекте' });
    throw e;
  }
});

router.delete('/work-entrances/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_floors WHERE entrance_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'В подъезде есть этажи — сначала удалите их' });
  const usedTransits = await pool.query('SELECT 1 FROM work_transits WHERE entrance_id = $1 LIMIT 1', [id]);
  if (usedTransits.rowCount) return res.status(400).json({ error: 'В подъезде есть транзиты — сначала удалите их' });
  const usedStairwells = await pool.query('SELECT 1 FROM work_stairwells WHERE entrance_id = $1 LIMIT 1', [id]);
  if (usedStairwells.rowCount) return res.status(400).json({ error: 'В подъезде есть лестничные клетки — сначала удалите их' });
  const r = await pool.query('DELETE FROM work_entrances WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Этажи ———
router.get('/work-floors', requirePermission('can_settings_work'), async (req, res) => {
  const entranceId = parseId(req.query.entrance_id);
  const params = [];
  let where = '';
  if (entranceId) {
    where = 'WHERE f.entrance_id = $1';
    params.push(entranceId);
  }
  const r = await pool.query(
    `SELECT f.id, f.name, f.entrance_id, f.sort_order, e.name AS entrance_name, e.object_id, o.name AS object_name, f.created_at
     FROM work_floors f
     JOIN work_entrances e ON e.id = f.entrance_id
     LEFT JOIN warehouse_objects o ON o.id = e.object_id
     ${where}
     ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-floors', requirePermission('can_settings_work'), async (req, res) => {
  const entrance_id = parseId(req.body?.entrance_id);
  const name = (req.body?.name || '').trim();
  const requestedSortOrder = parseOptionalPositiveInt(req.body?.sort_order);
  if (requestedSortOrder === null) return res.status(400).json({ error: 'Порядок этажа должен быть положительным числом' });
  if (!entrance_id || !name) return res.status(400).json({ error: 'Укажите подъезд и название этажа' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await resequenceEntranceFloors(client, entrance_id);
    const count = await getEntranceFloorsCount(client, entrance_id);
    const targetSortOrder = clampSortOrder(
      requestedSortOrder ?? (count + 1),
      1,
      count + 1,
    );
    if (targetSortOrder <= count) {
      await client.query(
        `UPDATE work_floors
         SET sort_order = sort_order + 1
         WHERE entrance_id = $1
           AND sort_order >= $2`,
        [entrance_id, targetSortOrder],
      );
    }
    const r = await client.query(
      `INSERT INTO work_floors (entrance_id, name, sort_order) VALUES ($1, $2, $3)
       RETURNING id, entrance_id, name, sort_order, created_at`,
      [entrance_id, name, targetSortOrder],
    );
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ error: 'Такой этаж уже есть в этом подъезде' });
    if (e.code === '23503') return res.status(400).json({ error: 'Подъезд не найден' });
    throw e;
  } finally {
    client.release();
  }
});

router.put('/work-floors/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const entrance_id = req.body?.entrance_id != null ? parseId(req.body.entrance_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  const requestedSortOrder = parseOptionalPositiveInt(req.body?.sort_order);
  if (requestedSortOrder === null) return res.status(400).json({ error: 'Порядок этажа должен быть положительным числом' });
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query(
      'SELECT id, entrance_id, name, sort_order FROM work_floors WHERE id = $1 FOR UPDATE',
      [id],
    )).rows[0];
    if (!cur) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Не найдено' });
    }
    await resequenceEntranceFloors(client, cur.entrance_id);
    const fresh = (await client.query(
      'SELECT id, entrance_id, name, sort_order FROM work_floors WHERE id = $1 FOR UPDATE',
      [id],
    )).rows[0];
    const eid = entrance_id ?? fresh.entrance_id;
    const nm = name ?? fresh.name;
    if (!eid || !nm) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Укажите подъезд и название' });
    }

    if (eid === fresh.entrance_id) {
      const count = await getEntranceFloorsCount(client, eid);
      const fromOrder = fresh.sort_order || 1;
      const targetSortOrder = clampSortOrder(
        requestedSortOrder ?? fromOrder,
        1,
        Math.max(1, count),
      );
      await moveFloorWithinEntrance(client, {
        entranceId: eid,
        floorId: id,
        fromOrder,
        toOrder: targetSortOrder,
      });
      await client.query(
        'UPDATE work_floors SET entrance_id = $1, name = $2, sort_order = $3 WHERE id = $4',
        [eid, nm, targetSortOrder, id],
      );
    } else {
      await resequenceEntranceFloors(client, eid);
      const sourceOrder = fresh.sort_order || 1;
      await client.query(
        `UPDATE work_floors
         SET sort_order = sort_order - 1
         WHERE entrance_id = $1
           AND sort_order > $2`,
        [fresh.entrance_id, sourceOrder],
      );

      const destinationCount = await getEntranceFloorsCount(client, eid);
      const targetSortOrder = clampSortOrder(
        requestedSortOrder ?? (destinationCount + 1),
        1,
        destinationCount + 1,
      );
      if (targetSortOrder <= destinationCount) {
        await client.query(
          `UPDATE work_floors
           SET sort_order = sort_order + 1
           WHERE entrance_id = $1
             AND sort_order >= $2`,
          [eid, targetSortOrder],
        );
      }
      await client.query(
        'UPDATE work_floors SET entrance_id = $1, name = $2, sort_order = $3 WHERE id = $4',
        [eid, nm, targetSortOrder, id],
      );
      await resequenceEntranceFloors(client, fresh.entrance_id);
    }

    await resequenceEntranceFloors(client, eid);
    const r = await client.query(
      `SELECT f.id, f.name, f.entrance_id, f.sort_order, e.name AS entrance_name, e.object_id, o.name AS object_name, f.created_at
       FROM work_floors f
       JOIN work_entrances e ON e.id = f.entrance_id
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       WHERE f.id = $1`,
      [id],
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ error: 'Такой этаж уже есть в подъезде' });
    throw e;
  } finally {
    client.release();
  }
});

router.post('/work-floors/:id/move', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const direction = String(req.body?.direction || '').toLowerCase();
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'Направление должно быть up или down' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = (await client.query(
      'SELECT id, entrance_id, sort_order FROM work_floors WHERE id = $1 FOR UPDATE',
      [id],
    )).rows[0];
    if (!cur) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Не найдено' });
    }

    await resequenceEntranceFloors(client, cur.entrance_id);
    const fresh = (await client.query(
      'SELECT id, entrance_id, sort_order FROM work_floors WHERE id = $1 FOR UPDATE',
      [id],
    )).rows[0];
    const count = await getEntranceFloorsCount(client, fresh.entrance_id);
    const fromOrder = fresh.sort_order || 1;
    const candidateOrder = direction === 'up' ? fromOrder - 1 : fromOrder + 1;
    const targetOrder = clampSortOrder(candidateOrder, 1, Math.max(1, count));

    await moveFloorWithinEntrance(client, {
      entranceId: fresh.entrance_id,
      floorId: id,
      fromOrder,
      toOrder: targetOrder,
    });
    await resequenceEntranceFloors(client, fresh.entrance_id);
    const r = await client.query(
      `SELECT f.id, f.name, f.entrance_id, f.sort_order, e.name AS entrance_name, e.object_id, o.name AS object_name, f.created_at
       FROM work_floors f
       JOIN work_entrances e ON e.id = f.entrance_id
       LEFT JOIN warehouse_objects o ON o.id = e.object_id
       WHERE f.id = $1`,
      [id],
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

router.delete('/work-floors/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_apartments WHERE floor_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'На этаже есть квартиры — сначала удалите их' });
  const usedTransit = await pool.query('SELECT 1 FROM work_transits WHERE from_floor_id = $1 OR to_floor_id = $1 LIMIT 1', [id]);
  if (usedTransit.rowCount) return res.status(400).json({ error: 'Этаж используется в транзитах — сначала удалите их' });
  const usedStairwell = await pool.query('SELECT 1 FROM work_stairwells WHERE from_floor_id = $1 OR to_floor_id = $1 LIMIT 1', [id]);
  if (usedStairwell.rowCount) return res.status(400).json({ error: 'Этаж используется в лестничных клетках — сначала удалите их' });
  const r = await pool.query('DELETE FROM work_floors WHERE id = $1 RETURNING id, entrance_id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  await resequenceEntranceFloors(pool, r.rows[0].entrance_id);
  res.json({ ok: true });
});

// ——— Квартиры ———
router.get('/work-apartments', requirePermission('can_settings_work'), async (req, res) => {
  const floorId = parseId(req.query.floor_id);
  const params = [];
  let where = '';
  if (floorId) {
    where = 'WHERE a.floor_id = $1';
    params.push(floorId);
  }
  const r = await pool.query(
    `SELECT a.id, a.name, a.floor_id, f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id, e.name AS entrance_name, a.created_at
     FROM work_apartments a
     JOIN work_floors f ON f.id = a.floor_id
     JOIN work_entrances e ON e.id = f.entrance_id
     ${where} ORDER BY e.name, COALESCE(f.sort_order, 2147483647), f.name, a.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-apartments', requirePermission('can_settings_work'), async (req, res) => {
  const floor_id = parseId(req.body?.floor_id);
  const name = (req.body?.name || '').trim();
  if (!floor_id || !name) return res.status(400).json({ error: 'Укажите этаж и название квартиры' });
  try {
    const r = await pool.query(
      `INSERT INTO work_apartments (floor_id, name) VALUES ($1, $2)
       RETURNING id, floor_id, name, created_at`,
      [floor_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая квартира уже есть на этом этаже' });
    if (e.code === '23503') return res.status(400).json({ error: 'Этаж не найден' });
    throw e;
  }
});

router.put('/work-apartments/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const floor_id = req.body?.floor_id != null ? parseId(req.body.floor_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT floor_id, name FROM work_apartments WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const fid = floor_id ?? cur.floor_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE work_apartments SET floor_id = $1, name = $2 WHERE id = $3 RETURNING id, floor_id, name, created_at',
      [fid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такая квартира уже есть на этаже' });
    throw e;
  }
});

router.delete('/work-apartments/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM work_rooms WHERE apartment_id = $1 LIMIT 1', [id]);
  if (used.rowCount) return res.status(400).json({ error: 'В квартире есть помещения — сначала удалите их' });
  await pool.query(`DELETE FROM work_location_systems WHERE location_kind = 'apartment' AND location_id = $1`, [id]);
  const r = await pool.query('DELETE FROM work_apartments WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Помещения ———
router.get('/work-rooms', requirePermission('can_settings_work'), async (req, res) => {
  const apartmentId = parseId(req.query.apartment_id);
  const params = [];
  let where = '';
  if (apartmentId) {
    where = 'WHERE r.apartment_id = $1';
    params.push(apartmentId);
  }
  const r = await pool.query(
    `SELECT r.id, r.name, r.apartment_id, a.name AS apartment_name,
            a.floor_id, f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id, e.name AS entrance_name, r.created_at
     FROM work_rooms r
     JOIN work_apartments a ON a.id = r.apartment_id
     JOIN work_floors f ON f.id = a.floor_id
     JOIN work_entrances e ON e.id = f.entrance_id
     ${where} ORDER BY e.name, COALESCE(f.sort_order, 2147483647), f.name, a.name, r.name`,
    params,
  );
  res.json(r.rows);
});

router.post('/work-rooms', requirePermission('can_settings_work'), async (req, res) => {
  const apartment_id = parseId(req.body?.apartment_id);
  const name = (req.body?.name || '').trim();
  if (!apartment_id || !name) return res.status(400).json({ error: 'Укажите квартиру и название помещения' });
  try {
    const r = await pool.query(
      `INSERT INTO work_rooms (apartment_id, name) VALUES ($1, $2)
       RETURNING id, apartment_id, name, created_at`,
      [apartment_id, name],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое помещение уже есть в этой квартире' });
    if (e.code === '23503') return res.status(400).json({ error: 'Квартира не найдена' });
    throw e;
  }
});

router.put('/work-rooms/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const apartment_id = req.body?.apartment_id != null ? parseId(req.body.apartment_id) : undefined;
  const name = req.body?.name != null ? (req.body.name || '').trim() : undefined;
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const cur = (await pool.query('SELECT apartment_id, name FROM work_rooms WHERE id = $1', [id])).rows[0];
  if (!cur) return res.status(404).json({ error: 'Не найдено' });
  const aid = apartment_id ?? cur.apartment_id;
  const nm = name ?? cur.name;
  if (!nm) return res.status(400).json({ error: 'Укажите название' });
  try {
    const r = await pool.query(
      'UPDATE work_rooms SET apartment_id = $1, name = $2 WHERE id = $3 RETURNING id, apartment_id, name, created_at',
      [aid, nm, id],
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такое помещение уже есть в квартире' });
    throw e;
  }
});

router.delete('/work-rooms/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  await pool.query(`DELETE FROM work_location_systems WHERE location_kind = 'room' AND location_id = $1`, [id]);
  const r = await pool.query('DELETE FROM work_rooms WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

function registerRangeLocationRoutes({
  kind,
  basePath,
  requiredMessage,
  notFoundReferenceMessage,
}) {
  const meta = getRangeLocationMeta(kind);
  if (!meta) return;
  const { table, alias, duplicateMessage, missingRefMessage } = meta;

  router.get(basePath, requirePermission('can_settings_work'), async (req, res) => {
    const objectId = parseId(req.query.object_id);
    const entranceId = parseId(req.query.entrance_id);
    const whereClauses = [];
    const params = [];
    if (objectId) {
      params.push(objectId);
      whereClauses.push(`${alias}.object_id = $${params.length}`);
    }
    if (entranceId) {
      params.push(entranceId);
      whereClauses.push(`${alias}.entrance_id = $${params.length}`);
    }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const rows = (await pool.query(
      `SELECT ${alias}.id, ${alias}.name, ${alias}.object_id, o.name AS object_name, ${alias}.entrance_id, e.name AS entrance_name,
              ${alias}.from_floor_id, ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
              ${alias}.to_floor_id, tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order,
              ${alias}.created_at
       FROM ${table} ${alias}
       JOIN work_entrances e ON e.id = ${alias}.entrance_id
       JOIN work_floors ff ON ff.id = ${alias}.from_floor_id
       JOIN work_floors tf ON tf.id = ${alias}.to_floor_id
       LEFT JOIN warehouse_objects o ON o.id = ${alias}.object_id
       ${where}
       ORDER BY o.name NULLS LAST, e.name, COALESCE(ff.sort_order, 2147483647), COALESCE(tf.sort_order, 2147483647), ${alias}.name`,
      params,
    )).rows;
    res.json(rows);
  });

  router.post(basePath, requirePermission('can_settings_work'), async (req, res) => {
    const object_id = parseId(req.body?.object_id);
    const entrance_id = parseId(req.body?.entrance_id);
    const from_floor_id = parseId(req.body?.from_floor_id);
    const to_floor_id = parseId(req.body?.to_floor_id);
    const name = (req.body?.name || '').trim();
    if (!object_id || !entrance_id || !from_floor_id || !to_floor_id || !name) {
      return res.status(400).json({ error: requiredMessage });
    }

    const range = await resolveEntranceFloorRange(pool, {
      objectId: object_id,
      entranceId: entrance_id,
      fromFloorId: from_floor_id,
      toFloorId: to_floor_id,
    });
    if (range.error) return res.status(400).json({ error: range.error });

    try {
      const created = (await pool.query(
        `INSERT INTO ${table} (name, object_id, entrance_id, from_floor_id, to_floor_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [name, range.objectId, range.entrance.id, range.fromFloor.id, range.toFloor.id],
      )).rows[0];
      const row = await loadRangeLocationRow(pool, kind, created.id);
      res.status(201).json(row);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: duplicateMessage });
      if (e.code === '23503') return res.status(400).json({ error: missingRefMessage });
      throw e;
    }
  });

  router.put(`${basePath}/:id`, requirePermission('can_settings_work'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Неверный id' });

    const current = (await pool.query(
      `SELECT id, name, object_id, entrance_id, from_floor_id, to_floor_id
       FROM ${table}
       WHERE id = $1`,
      [id],
    )).rows[0];
    if (!current) return res.status(404).json({ error: 'Не найдено' });

    const hasObject = Object.prototype.hasOwnProperty.call(req.body || {}, 'object_id');
    const hasEntrance = Object.prototype.hasOwnProperty.call(req.body || {}, 'entrance_id');
    const hasFromFloor = Object.prototype.hasOwnProperty.call(req.body || {}, 'from_floor_id');
    const hasToFloor = Object.prototype.hasOwnProperty.call(req.body || {}, 'to_floor_id');
    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, 'name');

    const object_id = hasObject ? parseId(req.body?.object_id) : current.object_id;
    const entrance_id = hasEntrance ? parseId(req.body?.entrance_id) : current.entrance_id;
    const from_floor_id = hasFromFloor ? parseId(req.body?.from_floor_id) : current.from_floor_id;
    const to_floor_id = hasToFloor ? parseId(req.body?.to_floor_id) : current.to_floor_id;
    const name = hasName ? (req.body?.name || '').trim() : current.name;

    if (!object_id || !entrance_id || !from_floor_id || !to_floor_id || !name) {
      return res.status(400).json({ error: requiredMessage });
    }

    const range = await resolveEntranceFloorRange(pool, {
      objectId: object_id,
      entranceId: entrance_id,
      fromFloorId: from_floor_id,
      toFloorId: to_floor_id,
    });
    if (range.error) return res.status(400).json({ error: range.error });

    try {
      await pool.query(
        `UPDATE ${table}
         SET name = $1, object_id = $2, entrance_id = $3, from_floor_id = $4, to_floor_id = $5
         WHERE id = $6`,
        [name, range.objectId, range.entrance.id, range.fromFloor.id, range.toFloor.id, id],
      );
      const row = await loadRangeLocationRow(pool, kind, id);
      res.json(row);
    } catch (e) {
      if (e.code === '23505') return res.status(400).json({ error: duplicateMessage });
      if (e.code === '23503') return res.status(400).json({ error: missingRefMessage });
      throw e;
    }
  });

  router.delete(`${basePath}/:id`, requirePermission('can_settings_work'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Неверный id' });
    await pool.query('DELETE FROM work_location_systems WHERE location_kind = $1 AND location_id = $2', [kind, id]);
    const deleted = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
    if (!deleted.rowCount) return res.status(404).json({ error: notFoundReferenceMessage });
    res.json({ ok: true });
  });
}

registerRangeLocationRoutes({
  kind: 'transit',
  basePath: '/work-transits',
  requiredMessage: 'Укажите объект, подъезд, этажи и название транзита',
  notFoundReferenceMessage: 'Транзит не найден',
});

registerRangeLocationRoutes({
  kind: 'stairwell',
  basePath: '/work-stairwells',
  requiredMessage: 'Укажите объект, подъезд, этажи и название лестничной клетки',
  notFoundReferenceMessage: 'Лестничная клетка не найдена',
});

// ——— Настройки объектов (монтажные системы и материалы) ———
router.get('/object-settings/layout', requirePermission('can_settings_work'), async (_req, res) => {
  try {
    const [
      objects,
      entrances,
      floors,
      apartments,
      rooms,
      transits,
      stairwells,
      systems,
      categories,
      blockStatuses,
      locationSystems,
      locationSystemMaterials,
      locationSystemEquipment,
      locationSystemWorks,
      transitCableLines,
    ] = await Promise.all([
      pool.query('SELECT id, name FROM warehouse_objects ORDER BY name'),
      pool.query(
        `SELECT e.id, e.name, e.object_id, o.name AS object_name
         FROM work_entrances e
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name`,
      ),
      pool.query(
        `SELECT f.id, f.name, f.entrance_id, f.sort_order,
                e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_floors f
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name`,
      ),
      pool.query(
        `SELECT a.id, a.name, a.floor_id,
                f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id,
                e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_apartments a
         JOIN work_floors f ON f.id = a.floor_id
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name, a.name`,
      ),
      pool.query(
        `SELECT r.id, r.name, r.apartment_id, a.name AS apartment_name,
                a.floor_id, f.name AS floor_name, f.sort_order AS floor_sort_order, f.entrance_id,
                e.name AS entrance_name, e.object_id, o.name AS object_name
         FROM work_rooms r
         JOIN work_apartments a ON a.id = r.apartment_id
         JOIN work_floors f ON f.id = a.floor_id
         JOIN work_entrances e ON e.id = f.entrance_id
         LEFT JOIN warehouse_objects o ON o.id = e.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(f.sort_order, 2147483647), f.name, a.name, r.name`,
      ),
      pool.query(
        `SELECT t.id, t.name, t.object_id, o.name AS object_name, t.entrance_id, e.name AS entrance_name,
                t.from_floor_id, ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
                t.to_floor_id, tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order,
                t.created_at
         FROM work_transits t
         JOIN work_entrances e ON e.id = t.entrance_id
         JOIN work_floors ff ON ff.id = t.from_floor_id
         JOIN work_floors tf ON tf.id = t.to_floor_id
         LEFT JOIN warehouse_objects o ON o.id = t.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(ff.sort_order, 2147483647), COALESCE(tf.sort_order, 2147483647), t.name`,
      ),
      pool.query(
        `SELECT s.id, s.name, s.object_id, o.name AS object_name, s.entrance_id, e.name AS entrance_name,
                s.from_floor_id, ff.name AS from_floor_name, ff.sort_order AS from_floor_sort_order,
                s.to_floor_id, tf.name AS to_floor_name, tf.sort_order AS to_floor_sort_order,
                s.created_at
         FROM work_stairwells s
         JOIN work_entrances e ON e.id = s.entrance_id
         JOIN work_floors ff ON ff.id = s.from_floor_id
         JOIN work_floors tf ON tf.id = s.to_floor_id
         LEFT JOIN warehouse_objects o ON o.id = s.object_id
         ORDER BY o.name NULLS LAST, e.name, COALESCE(ff.sort_order, 2147483647), COALESCE(tf.sort_order, 2147483647), s.name`,
      ),
      pool.query('SELECT id, name FROM material_systems ORDER BY name'),
      pool.query('SELECT id, name, icon_key FROM material_categories ORDER BY name'),
      pool.query('SELECT id, name, color, is_for_production, counts_as_produced, sort_order, created_at, updated_at FROM work_block_statuses ORDER BY sort_order, name'),
      pool.query(
        `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id, ls.status_id, ls.assigned_user_id, ls.created_at, ls.updated_at,
                s.name AS system_name,
                c.name AS category_name, c.icon_key AS category_icon_key,
                bs.name AS status_name, bs.color AS status_color,
                COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login) AS assigned_user_name,
                u.login AS assigned_user_login
         FROM work_location_systems ls
         JOIN material_systems s ON s.id = ls.system_id
         LEFT JOIN material_categories c ON c.id = ls.category_id
         LEFT JOIN work_block_statuses bs ON bs.id = ls.status_id
         LEFT JOIN users u ON u.id = ls.assigned_user_id
         ORDER BY ls.location_kind, ls.location_id, s.name`,
      ),
      pool.query(
        `SELECT lm.id, lm.location_system_id, lm.material_id, lm.quantity, lm.created_at, lm.updated_at,
                m.name AS material_name, m.unit AS material_unit, m.system_id, m.category_id
         FROM work_location_system_materials lm
         JOIN materials m ON m.id = lm.material_id
         ORDER BY lm.location_system_id, m.name`,
      ),
      pool.query(
        `SELECT id, location_system_id, name, quantity, created_at, updated_at
         FROM work_location_system_equipment
         ORDER BY location_system_id, name`,
      ),
      pool.query(
        `SELECT id, location_system_id, name, quantity, created_at, updated_at
         FROM work_location_system_works
         ORDER BY location_system_id, name`,
      ),
      pool.query(
        `SELECT id, transit_id, from_location_system_id, to_location_system_id, name, length_m, created_at, updated_at
         FROM work_transit_cable_lines
         ORDER BY transit_id, id`,
      ),
    ]);
    res.json({
      objects: objects.rows,
      entrances: entrances.rows,
      floors: floors.rows,
      apartments: apartments.rows,
      rooms: rooms.rows,
      transits: transits.rows,
      stairwells: stairwells.rows,
      systems: systems.rows,
      categories: categories.rows,
      block_statuses: blockStatuses.rows,
      location_systems: locationSystems.rows,
      location_system_materials: locationSystemMaterials.rows,
      location_system_equipment: locationSystemEquipment.rows,
      location_system_works: locationSystemWorks.rows,
      transit_cable_lines: transitCableLines.rows,
    });
  } catch (e) {
    console.error('GET /settings/object-settings/layout:', e.message);
    res.status(500).json({ error: 'Ошибка загрузки настроек объектов' });
  }
});

router.post('/object-settings/transits/:transitId/cable-lines', requirePermission('can_settings_work'), async (req, res) => {
  const transitId = parseId(req.params.transitId);
  const fromLocationSystemId = parseId(req.body?.from_location_system_id);
  const toLocationSystemId = parseId(req.body?.to_location_system_id);
  const name = parseRequiredName(req.body?.name, 200);
  const lengthM = parsePositiveDecimal(req.body?.length_m);
  if (!transitId || !fromLocationSystemId || !toLocationSystemId || !name || !lengthM) {
    return res.status(400).json({ error: 'Укажите транзит, 2 блока, название и длину кабеля' });
  }

  const validated = await validateTransitCableLineInput(pool, {
    transitId,
    fromLocationSystemId,
    toLocationSystemId,
    name,
    lengthM,
  });
  if (validated.error) return res.status(400).json({ error: validated.error });

  const created = (await pool.query(
    `INSERT INTO work_transit_cable_lines (
      transit_id,
      from_location_system_id,
      to_location_system_id,
      name,
      length_m
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id`,
    [transitId, fromLocationSystemId, toLocationSystemId, name, lengthM],
  )).rows[0];
  const row = await loadTransitCableLineById(pool, created.id);
  res.status(201).json(row);
});

router.put('/object-settings/transit-cable-lines/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });

  const current = await loadTransitCableLineById(pool, id);
  if (!current) return res.status(404).json({ error: 'Кабельная линия не найдена' });

  const transitId = req.body?.transit_id === undefined ? current.transit_id : parseId(req.body?.transit_id);
  const fromLocationSystemId = req.body?.from_location_system_id === undefined
    ? current.from_location_system_id
    : parseId(req.body?.from_location_system_id);
  const toLocationSystemId = req.body?.to_location_system_id === undefined
    ? current.to_location_system_id
    : parseId(req.body?.to_location_system_id);
  const name = req.body?.name === undefined ? current.name : parseRequiredName(req.body?.name, 200);
  const lengthM = req.body?.length_m === undefined
    ? parsePositiveDecimal(current.length_m)
    : parsePositiveDecimal(req.body?.length_m);

  if (!transitId || !fromLocationSystemId || !toLocationSystemId || !name || !lengthM) {
    return res.status(400).json({ error: 'Неверные данные кабельной линии' });
  }

  const validated = await validateTransitCableLineInput(pool, {
    transitId,
    fromLocationSystemId,
    toLocationSystemId,
    name,
    lengthM,
  });
  if (validated.error) return res.status(400).json({ error: validated.error });

  await pool.query(
    `UPDATE work_transit_cable_lines
     SET transit_id = $1,
         from_location_system_id = $2,
         to_location_system_id = $3,
         name = $4,
         length_m = $5,
         updated_at = NOW()
     WHERE id = $6`,
    [transitId, fromLocationSystemId, toLocationSystemId, name, lengthM, id],
  );
  const row = await loadTransitCableLineById(pool, id);
  res.json(row);
});

router.delete('/object-settings/transit-cable-lines/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const removed = await pool.query('DELETE FROM work_transit_cable_lines WHERE id = $1 RETURNING id', [id]);
  if (!removed.rowCount) return res.status(404).json({ error: 'Кабельная линия не найдена' });
  res.json({ ok: true });
});

router.post('/object-settings/location-systems', requirePermission('can_settings_work'), async (req, res) => {
  const locationKind = String(req.body?.location_kind || '').trim();
  const locationId = parseId(req.body?.location_id);
  const systemId = parseId(req.body?.system_id);
  if (!locationId || !systemId || !WORK_LOCATION_KINDS.includes(locationKind)) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  const categoryId = req.body?.category_id == null || req.body?.category_id === ''
    ? null
    : parseId(req.body?.category_id);
  if (req.body?.category_id != null && req.body?.category_id !== '' && !categoryId) {
    return res.status(400).json({ error: 'Неверная категория' });
  }
  const location = await loadLocationByKind(pool, locationKind, locationId);
  if (!location) return res.status(404).json({ error: 'Локация не найдена' });
  const system = (await pool.query('SELECT id, name FROM material_systems WHERE id = $1', [systemId])).rows[0];
  if (!system) return res.status(400).json({ error: 'Система не найдена' });
  if (categoryId) {
    const category = (await pool.query('SELECT id FROM material_categories WHERE id = $1', [categoryId])).rows[0];
    if (!category) return res.status(400).json({ error: 'Категория не найдена' });
  }
  const created = (await pool.query(
    `INSERT INTO work_location_systems (location_kind, location_id, system_id, category_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, location_kind, location_id, system_id, category_id, created_at, updated_at`,
    [locationKind, locationId, systemId, categoryId],
  )).rows[0];
  const withMeta = (await pool.query(
    `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id, ls.status_id, ls.assigned_user_id, ls.created_at, ls.updated_at,
            s.name AS system_name,
            c.name AS category_name, c.icon_key AS category_icon_key,
            bs.name AS status_name, bs.color AS status_color,
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login) AS assigned_user_name,
            u.login AS assigned_user_login
     FROM work_location_systems ls
     JOIN material_systems s ON s.id = ls.system_id
     LEFT JOIN material_categories c ON c.id = ls.category_id
     LEFT JOIN work_block_statuses bs ON bs.id = ls.status_id
     LEFT JOIN users u ON u.id = ls.assigned_user_id
     WHERE ls.id = $1`,
    [created.id],
  )).rows[0];
  res.status(201).json(withMeta);
});

router.put('/object-settings/location-systems/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const current = (await pool.query(
    'SELECT id, location_kind, location_id, system_id, category_id FROM work_location_systems WHERE id = $1',
    [id],
  )).rows[0];
  if (!current) return res.status(404).json({ error: 'Не найдено' });
  const systemId = req.body?.system_id === undefined
    ? current.system_id
    : parseId(req.body?.system_id);
  if (!systemId) return res.status(400).json({ error: 'Неверная система' });
  const system = (await pool.query('SELECT id FROM material_systems WHERE id = $1', [systemId])).rows[0];
  if (!system) return res.status(400).json({ error: 'Система не найдена' });
  const categoryId = req.body?.category_id == null || req.body?.category_id === ''
    ? (req.body?.category_id === undefined ? current.category_id : null)
    : parseId(req.body?.category_id);
  if (req.body?.category_id !== undefined && req.body?.category_id != null && req.body?.category_id !== '' && !categoryId) {
    return res.status(400).json({ error: 'Неверная категория' });
  }
  if (categoryId) {
    const category = (await pool.query('SELECT id FROM material_categories WHERE id = $1', [categoryId])).rows[0];
    if (!category) return res.status(400).json({ error: 'Категория не найдена' });
  }
  const updated = (await pool.query(
    `UPDATE work_location_systems
     SET system_id = $1, category_id = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id`,
    [systemId, categoryId, id],
  )).rows[0];
  if (!updated) return res.status(404).json({ error: 'Не найдено' });
  const row = (await pool.query(
    `SELECT ls.id, ls.location_kind, ls.location_id, ls.system_id, ls.category_id, ls.status_id, ls.assigned_user_id, ls.created_at, ls.updated_at,
            s.name AS system_name,
            c.name AS category_name, c.icon_key AS category_icon_key,
            bs.name AS status_name, bs.color AS status_color,
            COALESCE(NULLIF(TRIM(u.display_name), ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.login) AS assigned_user_name,
            u.login AS assigned_user_login
     FROM work_location_systems ls
     JOIN material_systems s ON s.id = ls.system_id
     LEFT JOIN material_categories c ON c.id = ls.category_id
     LEFT JOIN work_block_statuses bs ON bs.id = ls.status_id
     LEFT JOIN users u ON u.id = ls.assigned_user_id
     WHERE ls.id = $1`,
    [id],
  )).rows[0];
  res.json(row);
});

router.delete('/object-settings/location-systems/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const r = await pool.query('DELETE FROM work_location_systems WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

router.delete('/object-settings/locations/:locationKind/:locationId/blocks', requirePermission('can_settings_work'), async (req, res) => {
  const locationKind = String(req.params.locationKind || '').trim();
  const locationId = parseId(req.params.locationId);
  if (!locationId || !WORK_LOCATION_KINDS.includes(locationKind)) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  const location = await loadLocationByKind(pool, locationKind, locationId);
  if (!location) return res.status(404).json({ error: 'Локация не найдена' });
  const removed = await pool.query(
    'DELETE FROM work_location_systems WHERE location_kind = $1 AND location_id = $2 RETURNING id',
    [locationKind, locationId],
  );
  res.json({ ok: true, deleted_blocks: removed.rowCount });
});

router.get('/object-settings/material-suggestions', requirePermission('can_settings_work'), async (req, res) => {
  const systemId = parseId(req.query.system_id);
  const q = String(req.query.q || '').trim();
  const categoryId = req.query.category_id == null || req.query.category_id === ''
    ? null
    : parseId(req.query.category_id);
  if (!systemId) return res.status(400).json({ error: 'Нужно указать систему' });
  if (req.query.category_id != null && req.query.category_id !== '' && !categoryId) {
    return res.status(400).json({ error: 'Неверная категория' });
  }
  const like = `%${q}%`;
  const params = [systemId];
  let where = 'WHERE m.system_id = $1';
  if (categoryId) {
    params.push(categoryId);
    where += ` AND m.category_id = $${params.length}`;
  }
  if (q) {
    params.push(like);
    where += ` AND m.name ILIKE $${params.length}`;
  }
  const rows = (await pool.query(
    `SELECT m.id, m.name, m.unit, m.quantity, m.system_id, m.category_id,
            c.name AS category_name, c.icon_key AS category_icon_key
     FROM materials m
     LEFT JOIN material_categories c ON c.id = m.category_id
     ${where}
     ORDER BY m.name
     LIMIT 30`,
    params,
  )).rows;
  res.json(rows);
});

router.post('/object-settings/entries/bulk-rename', requirePermission('can_settings_work'), async (req, res) => {
  const sourceName = parseRequiredName(req.body?.source_name);
  const nextName = parseRequiredName(req.body?.name);
  const targetSystemId = parseId(req.body?.system_id);
  const targetCategoryId = req.body?.category_id == null || req.body?.category_id === ''
    ? null
    : parseId(req.body?.category_id);
  const slotIds = Array.isArray(req.body?.slot_ids)
    ? [...new Set(req.body.slot_ids.map((v) => parseId(v)).filter(Boolean))]
    : [];
  if (!sourceName || !nextName || !targetSystemId || !slotIds.length) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  if (req.body?.category_id != null && req.body?.category_id !== '' && !targetCategoryId) {
    return res.status(400).json({ error: 'Неверная категория' });
  }

  const system = (await pool.query('SELECT id FROM material_systems WHERE id = $1', [targetSystemId])).rows[0];
  if (!system) return res.status(400).json({ error: 'Система не найдена' });
  if (targetCategoryId) {
    const category = (await pool.query('SELECT id FROM material_categories WHERE id = $1', [targetCategoryId])).rows[0];
    if (!category) return res.status(400).json({ error: 'Категория не найдена' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceSlots = (await client.query(
      `SELECT id, location_kind, location_id
       FROM work_location_systems
       WHERE id = ANY($1::int[])`,
      [slotIds],
    )).rows;
    if (!sourceSlots.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Блоки для изменения не найдены' });
    }
    const sourceSlotIds = sourceSlots.map((row) => row.id);

    const [
      materialEntries,
      equipmentEntries,
      workEntries,
    ] = await Promise.all([
      client.query(
        `SELECT lm.id, lm.location_system_id, lm.material_id, lm.quantity,
                ls.location_kind, ls.location_id
         FROM work_location_system_materials lm
         JOIN work_location_systems ls ON ls.id = lm.location_system_id
         JOIN materials m ON m.id = lm.material_id
         WHERE lm.location_system_id = ANY($1::int[])
           AND LOWER(TRIM(m.name)) = LOWER(TRIM($2))`,
        [sourceSlotIds, sourceName],
      ),
      client.query(
        `SELECT eq.id, eq.location_system_id, eq.quantity,
                ls.location_kind, ls.location_id
         FROM work_location_system_equipment eq
         JOIN work_location_systems ls ON ls.id = eq.location_system_id
         WHERE eq.location_system_id = ANY($1::int[])
           AND LOWER(TRIM(eq.name)) = LOWER(TRIM($2))`,
        [sourceSlotIds, sourceName],
      ),
      client.query(
        `SELECT w.id, w.location_system_id, w.quantity,
                ls.location_kind, ls.location_id
         FROM work_location_system_works w
         JOIN work_location_systems ls ON ls.id = w.location_system_id
         WHERE w.location_system_id = ANY($1::int[])
           AND LOWER(TRIM(w.name)) = LOWER(TRIM($2))`,
        [sourceSlotIds, sourceName],
      ),
    ]);

    const totalMatched = materialEntries.rowCount + equipmentEntries.rowCount + workEntries.rowCount;
    if (!totalMatched) {
      await client.query('COMMIT');
      return res.json({
        ok: true,
        matched_entries: 0,
        updated_entries: 0,
        converted_material_entries: 0,
        created_target_blocks: 0,
      });
    }

    const targetSlotsCache = new Map();
    let createdTargetBlocks = 0;
    const touchedLocations = new Set();

    const resolveTargetSlotId = async (locationKind, locationId) => {
      const key = `${locationKind}:${locationId}`;
      if (targetSlotsCache.has(key)) return targetSlotsCache.get(key);
      const existing = (await client.query(
        `SELECT id
         FROM work_location_systems
         WHERE location_kind = $1
           AND location_id = $2
           AND system_id = $3
           AND (($4::int IS NULL AND category_id IS NULL) OR category_id = $4)
         ORDER BY id
         LIMIT 1`,
        [locationKind, locationId, targetSystemId, targetCategoryId],
      )).rows[0];
      if (existing?.id) {
        targetSlotsCache.set(key, existing.id);
        return existing.id;
      }
      const inserted = (await client.query(
        `INSERT INTO work_location_systems (location_kind, location_id, system_id, category_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [locationKind, locationId, targetSystemId, targetCategoryId],
      )).rows[0];
      createdTargetBlocks += 1;
      targetSlotsCache.set(key, inserted.id);
      return inserted.id;
    };

    let updatedEquipment = 0;
    for (const row of equipmentEntries.rows) {
      const targetSlotId = await resolveTargetSlotId(row.location_kind, row.location_id);
      await client.query(
        `UPDATE work_location_system_equipment
         SET location_system_id = $1, name = $2, updated_at = NOW()
         WHERE id = $3`,
        [targetSlotId, nextName, row.id],
      );
      updatedEquipment += 1;
      touchedLocations.add(`${row.location_kind}:${row.location_id}`);
    }

    let updatedWorks = 0;
    for (const row of workEntries.rows) {
      const targetSlotId = await resolveTargetSlotId(row.location_kind, row.location_id);
      await client.query(
        `UPDATE work_location_system_works
         SET location_system_id = $1, name = $2, updated_at = NOW()
         WHERE id = $3`,
        [targetSlotId, nextName, row.id],
      );
      updatedWorks += 1;
      touchedLocations.add(`${row.location_kind}:${row.location_id}`);
    }

    const exactMaterial = (await client.query(
      `SELECT id
       FROM materials
       WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
         AND system_id = $2
         AND (($3::int IS NULL AND category_id IS NULL) OR category_id = $3)
       ORDER BY (parent_material_id IS NOT NULL), id
       LIMIT 1`,
      [nextName, targetSystemId, targetCategoryId],
    )).rows[0];
    const replacementMaterialId = exactMaterial?.id || null;

    let updatedMaterials = 0;
    let convertedMaterials = 0;
    for (const row of materialEntries.rows) {
      const targetSlotId = await resolveTargetSlotId(row.location_kind, row.location_id);
      if (replacementMaterialId) {
        const duplicate = (await client.query(
          `SELECT id
           FROM work_location_system_materials
           WHERE location_system_id = $1
             AND material_id = $2
             AND id <> $3
           LIMIT 1`,
          [targetSlotId, replacementMaterialId, row.id],
        )).rows[0];
        if (duplicate?.id) {
          await client.query(
            `UPDATE work_location_system_materials
             SET quantity = quantity + $1, updated_at = NOW()
             WHERE id = $2`,
            [row.quantity, duplicate.id],
          );
          await client.query('DELETE FROM work_location_system_materials WHERE id = $1', [row.id]);
        } else {
          await client.query(
            `UPDATE work_location_system_materials
             SET location_system_id = $1, material_id = $2, updated_at = NOW()
             WHERE id = $3`,
            [targetSlotId, replacementMaterialId, row.id],
          );
        }
        updatedMaterials += 1;
      } else {
        await client.query(
          `INSERT INTO work_location_system_equipment (location_system_id, name, quantity)
           VALUES ($1, $2, $3)`,
          [targetSlotId, nextName, row.quantity],
        );
        await client.query('DELETE FROM work_location_system_materials WHERE id = $1', [row.id]);
        convertedMaterials += 1;
      }
      touchedLocations.add(`${row.location_kind}:${row.location_id}`);
    }

    await client.query('COMMIT');
    res.json({
      ok: true,
      matched_entries: totalMatched,
      updated_entries: updatedEquipment + updatedWorks + updatedMaterials + convertedMaterials,
      updated_material_entries: updatedMaterials,
      converted_material_entries: convertedMaterials,
      updated_equipment_entries: updatedEquipment,
      updated_work_entries: updatedWorks,
      created_target_blocks: createdTargetBlocks,
      affected_locations: touchedLocations.size,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
});

router.post('/object-settings/location-systems/:id/materials', requirePermission('can_settings_work'), async (req, res) => {
  const locationSystemId = parseId(req.params.id);
  const materialId = parseId(req.body?.material_id);
  const quantity = parsePositiveDecimal(req.body?.quantity);
  if (!locationSystemId || !materialId || !quantity) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  const locationSystem = (await pool.query(
    `SELECT id, system_id
     FROM work_location_systems
     WHERE id = $1`,
    [locationSystemId],
  )).rows[0];
  if (!locationSystem) return res.status(404).json({ error: 'Блок системы не найден' });
  const material = (await pool.query(
    `SELECT id, name, unit, system_id, category_id
     FROM materials
     WHERE id = $1`,
    [materialId],
  )).rows[0];
  if (!material) return res.status(400).json({ error: 'Материал не найден' });
  if (material.system_id !== locationSystem.system_id) {
    return res.status(400).json({ error: 'Материал относится к другой системе' });
  }
  try {
    const created = (await pool.query(
      `INSERT INTO work_location_system_materials (location_system_id, material_id, quantity)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [locationSystemId, materialId, quantity],
    )).rows[0];
    const row = (await pool.query(
      `SELECT lm.id, lm.location_system_id, lm.material_id, lm.quantity, lm.created_at, lm.updated_at,
              m.name AS material_name, m.unit AS material_unit, m.system_id, m.category_id
       FROM work_location_system_materials lm
       JOIN materials m ON m.id = lm.material_id
       WHERE lm.id = $1`,
      [created.id],
    )).rows[0];
    res.status(201).json(row);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Материал уже добавлен в этот блок' });
    throw e;
  }
});

router.put('/object-settings/location-system-materials/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  const quantity = parsePositiveDecimal(req.body?.quantity);
  if (!id || !quantity) return res.status(400).json({ error: 'Неверные данные' });
  const row = (await pool.query(
    `UPDATE work_location_system_materials
     SET quantity = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id`,
    [quantity, id],
  )).rows[0];
  if (!row) return res.status(404).json({ error: 'Не найдено' });
  const withMeta = (await pool.query(
    `SELECT lm.id, lm.location_system_id, lm.material_id, lm.quantity, lm.created_at, lm.updated_at,
            m.name AS material_name, m.unit AS material_unit, m.system_id, m.category_id
     FROM work_location_system_materials lm
     JOIN materials m ON m.id = lm.material_id
     WHERE lm.id = $1`,
    [id],
  )).rows[0];
  res.json(withMeta);
});

router.delete('/object-settings/location-system-materials/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const r = await pool.query('DELETE FROM work_location_system_materials WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

router.post('/object-settings/location-systems/:id/equipment', requirePermission('can_settings_work'), async (req, res) => {
  const locationSystemId = parseId(req.params.id);
  const name = parseRequiredName(req.body?.name);
  const quantity = parsePositiveDecimal(req.body?.quantity);
  if (!locationSystemId || !name || !quantity) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  const slot = (await pool.query('SELECT id FROM work_location_systems WHERE id = $1', [locationSystemId])).rows[0];
  if (!slot) return res.status(404).json({ error: 'Блок системы не найден' });
  const created = (await pool.query(
    `INSERT INTO work_location_system_equipment (location_system_id, name, quantity)
     VALUES ($1, $2, $3)
     RETURNING id, location_system_id, name, quantity, created_at, updated_at`,
    [locationSystemId, name, quantity],
  )).rows[0];
  res.status(201).json(created);
});

router.put('/object-settings/location-system-equipment/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const current = (await pool.query(
    'SELECT id, name, quantity FROM work_location_system_equipment WHERE id = $1',
    [id],
  )).rows[0];
  if (!current) return res.status(404).json({ error: 'Не найдено' });
  const nextName = req.body?.name !== undefined ? parseRequiredName(req.body?.name) : current.name;
  const nextQuantity = req.body?.quantity !== undefined ? parsePositiveDecimal(req.body?.quantity) : Number(current.quantity);
  if (!nextName || !nextQuantity) return res.status(400).json({ error: 'Неверные данные' });
  const updated = (await pool.query(
    `UPDATE work_location_system_equipment
     SET name = $1, quantity = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, location_system_id, name, quantity, created_at, updated_at`,
    [nextName, nextQuantity, id],
  )).rows[0];
  res.json(updated);
});

router.delete('/object-settings/location-system-equipment/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const r = await pool.query('DELETE FROM work_location_system_equipment WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

router.post('/object-settings/location-systems/:id/works', requirePermission('can_settings_work'), async (req, res) => {
  const locationSystemId = parseId(req.params.id);
  const name = parseRequiredName(req.body?.name);
  const quantity = parsePositiveDecimal(req.body?.quantity);
  if (!locationSystemId || !name || !quantity) {
    return res.status(400).json({ error: 'Неверные данные' });
  }
  const slot = (await pool.query('SELECT id FROM work_location_systems WHERE id = $1', [locationSystemId])).rows[0];
  if (!slot) return res.status(404).json({ error: 'Блок системы не найден' });
  const created = (await pool.query(
    `INSERT INTO work_location_system_works (location_system_id, name, quantity)
     VALUES ($1, $2, $3)
     RETURNING id, location_system_id, name, quantity, created_at, updated_at`,
    [locationSystemId, name, quantity],
  )).rows[0];
  res.status(201).json(created);
});

router.put('/object-settings/location-system-works/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const current = (await pool.query(
    'SELECT id, name, quantity FROM work_location_system_works WHERE id = $1',
    [id],
  )).rows[0];
  if (!current) return res.status(404).json({ error: 'Не найдено' });
  const nextName = req.body?.name !== undefined ? parseRequiredName(req.body?.name) : current.name;
  const nextQuantity = req.body?.quantity !== undefined ? parsePositiveDecimal(req.body?.quantity) : Number(current.quantity);
  if (!nextName || !nextQuantity) return res.status(400).json({ error: 'Неверные данные' });
  const updated = (await pool.query(
    `UPDATE work_location_system_works
     SET name = $1, quantity = $2, updated_at = NOW()
     WHERE id = $3
     RETURNING id, location_system_id, name, quantity, created_at, updated_at`,
    [nextName, nextQuantity, id],
  )).rows[0];
  res.json(updated);
});

router.delete('/object-settings/location-system-works/:id', requirePermission('can_settings_work'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const r = await pool.query('DELETE FROM work_location_system_works WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

// ——— Организации ———
router.post('/organizations', requirePermission('can_settings_organizations'), async (req, res) => {
  const parsed = parseOrgBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const {
    name, inn, kpp, ogrn, legal_address, actual_address, phone, email,
    director_name, bank_name, bank_bik, bank_account, bank_corr_account,
  } = parsed;
  try {
    const r = await pool.query(
      `INSERT INTO organizations (
        name, inn, kpp, ogrn, legal_address, actual_address, phone, email,
        director_name, bank_name, bank_bik, bank_account, bank_corr_account
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING ${ORG_SELECT}`,
      [
        name, inn, kpp, ogrn, legal_address, actual_address, phone, email,
        director_name, bank_name, bank_bik, bank_account, bank_corr_account,
      ],
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Организация с таким наименованием уже есть' });
    throw e;
  }
});

router.put('/organizations/:id', requirePermission('can_settings_organizations'), async (req, res) => {
  const id = parseId(req.params.id);
  const parsed = parseOrgBody(req.body);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const {
    name, inn, kpp, ogrn, legal_address, actual_address, phone, email,
    director_name, bank_name, bank_bik, bank_account, bank_corr_account,
  } = parsed;
  try {
    const r = await pool.query(
      `UPDATE organizations SET
        name = $1, inn = $2, kpp = $3, ogrn = $4, legal_address = $5, actual_address = $6,
        phone = $7, email = $8, director_name = $9, bank_name = $10, bank_bik = $11,
        bank_account = $12, bank_corr_account = $13
      WHERE id = $14
      RETURNING ${ORG_SELECT}`,
      [
        name, inn, kpp, ogrn, legal_address, actual_address, phone, email,
        director_name, bank_name, bank_bik, bank_account, bank_corr_account, id,
      ],
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
    await pool.query('UPDATE users SET employment_org = $1 WHERE organization_id = $2', [name, id]);
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Организация с таким наименованием уже есть' });
    throw e;
  }
});

router.delete('/organizations/:id', requirePermission('can_settings_organizations'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Неверный id' });
  const used = await pool.query('SELECT 1 FROM users WHERE organization_id = $1 LIMIT 1', [id]);
  if (used.rowCount) {
    return res.status(400).json({ error: 'Организация назначена пользователям. Сначала смените трудоустройство у сотрудников.' });
  }
  const r = await pool.query('DELETE FROM organizations WHERE id = $1 RETURNING id', [id]);
  if (!r.rowCount) return res.status(404).json({ error: 'Не найдено' });
  res.json({ ok: true });
});

export default router;
