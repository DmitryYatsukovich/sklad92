import { resolveLocationFromNames } from './material-excel.js';
import { logQuantityChange } from './material-quantity-log.js';

async function findByCode(client, code) {
  if (!code?.trim()) return null;
  return (await client.query(
    'SELECT id, parent_material_id, quantity FROM materials WHERE code = $1',
    [code.trim()],
  )).rows[0] || null;
}

async function findGroupByCode(client, code) {
  if (!code?.trim()) return null;
  return (await client.query(
    'SELECT id, name, quantity FROM materials WHERE code = $1 AND parent_material_id IS NULL',
    [code.trim()],
  )).rows[0] || null;
}

async function findPartByParentIndex(client, parentId, partIndex) {
  const r = await client.query(
    `SELECT id, parent_material_id, quantity, code
     FROM materials WHERE parent_material_id = $1 AND part_index = $2`,
    [parentId, partIndex],
  );
  return r.rows[0] || null;
}

async function materialHasParts(client, materialId) {
  const r = await client.query(
    'SELECT 1 FROM materials WHERE parent_material_id = $1 LIMIT 1',
    [materialId],
  );
  return r.rows.length > 0;
}

async function nextPartIndex(client, parentId) {
  const r = await client.query(
    'SELECT COALESCE(MAX(part_index), 0) + 1 AS n FROM materials WHERE parent_material_id = $1',
    [parentId],
  );
  return Number(r.rows[0]?.n) || 1;
}

function buildImportContext(items) {
  const groupsWithPartsInFile = new Set(
    items
      .filter((i) => i.rowType === 'part')
      .map((i) => String(i.group_code || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const groupsInFile = new Set(
    items
      .filter((i) => i.rowType === 'group')
      .map((i) => String(i.code || i.group_code || '').trim().toLowerCase())
      .filter(Boolean),
  );
  return { groupsWithPartsInFile, groupsInFile };
}

/** Создать справочники из файла, если ещё нет. */
async function ensureCatalogNames(client, lookups, item) {
  const on = item.object_name?.trim();
  const wn = item.warehouse_name?.trim();
  const rn = item.rack_name?.trim();
  const cn = item.category_name?.trim();

  if (cn) {
    const ck = cn.toLowerCase();
    if (!lookups.categories.get(ck)) {
      try {
        const r = await client.query(
          'INSERT INTO material_categories (name) VALUES ($1) RETURNING id',
          [cn],
        );
        lookups.categories.set(ck, r.rows[0].id);
      } catch (e) {
        if (e.code === '23505') {
          const ex = await client.query(
            'SELECT id FROM material_categories WHERE LOWER(TRIM(name)) = $1',
            [ck],
          );
          if (ex.rows[0]) lookups.categories.set(ck, ex.rows[0].id);
        } else throw e;
      }
    }
  }

  if (on) {
    const ok = on.toLowerCase();
    if (!lookups.objects.get(ok)) {
      try {
        const r = await client.query(
          'INSERT INTO warehouse_objects (name) VALUES ($1) RETURNING id',
          [on],
        );
        lookups.objects.set(ok, r.rows[0].id);
      } catch (e) {
        if (e.code === '23505') {
          const ex = await client.query(
            'SELECT id FROM warehouse_objects WHERE LOWER(TRIM(name)) = $1',
            [ok],
          );
          if (ex.rows[0]) lookups.objects.set(ok, ex.rows[0].id);
        } else throw e;
      }
    }
  }

  if (wn) {
    const wkey = wn.toLowerCase();
    if (!lookups.warehouses.some((w) => w.key === wkey)) {
      let objectId = on ? lookups.objects.get(on.toLowerCase()) : null;
      if (!objectId) {
        const fallback = 'Основной объект';
        const fk = fallback.toLowerCase();
        if (!lookups.objects.get(fk)) {
          const r = await client.query(
            'INSERT INTO warehouse_objects (name) VALUES ($1) RETURNING id',
            [fallback],
          );
          lookups.objects.set(fk, r.rows[0].id);
        }
        objectId = lookups.objects.get(fk);
      }
      try {
        const r = await client.query(
          'INSERT INTO warehouses (object_id, name) VALUES ($1, $2) RETURNING id, object_id',
          [objectId, wn],
        );
        lookups.warehouses.push({ id: r.rows[0].id, object_id: r.rows[0].object_id, key: wkey });
      } catch (e) {
        if (e.code === '23505') {
          const ex = await client.query(
            `SELECT w.id, w.object_id FROM warehouses w
             WHERE LOWER(TRIM(w.name)) = $1 ORDER BY w.id LIMIT 1`,
            [wkey],
          );
          if (ex.rows[0]) {
            lookups.warehouses.push({
              id: ex.rows[0].id,
              object_id: ex.rows[0].object_id,
              key: wkey,
            });
          }
        } else throw e;
      }
    }
  }

  if (rn) {
    const rkey = rn.toLowerCase();
    if (!lookups.racks.some((r) => r.key === rkey)) {
      const wh = lookups.warehouses.find((w) => w.key === (wn || '').toLowerCase())
        || lookups.warehouses[lookups.warehouses.length - 1];
      if (!wh) return;
      try {
        const r = await client.query(
          'INSERT INTO warehouse_racks (warehouse_id, name) VALUES ($1, $2) RETURNING id, warehouse_id',
          [wh.id, rn],
        );
        lookups.racks.push({ id: r.rows[0].id, warehouse_id: r.rows[0].warehouse_id, key: rkey });
      } catch (e) {
        if (e.code === '23505') {
          const ex = await client.query(
            `SELECT r.id, r.warehouse_id FROM warehouse_racks r
             WHERE LOWER(TRIM(r.name)) = $1 ORDER BY r.id LIMIT 1`,
            [rkey],
          );
          if (ex.rows[0]) {
            lookups.racks.push({
              id: ex.rows[0].id,
              warehouse_id: ex.rows[0].warehouse_id,
              key: rkey,
            });
          }
        } else throw e;
      }
    }
  }
}

async function validateImportItem(client, lookups, item, ctx, { dryRun = false } = {}) {
  const code = item.code?.trim();
  const groupCode = (item.group_code || '').trim();

  if (item.rowType === 'part' && !groupCode) {
    throw new Error('Укажите код группы для части');
  }
  if (item.rowType === 'group' && !code && !groupCode) {
    throw new Error('Укажите код группы');
  }

  if (item.rowType === 'group') {
    const parentCode = (code || groupCode).toLowerCase();
    if (ctx.seenGroupCodes.has(parentCode)) {
      throw new Error('Дублирующийся код группы в файле');
    }
    ctx.seenGroupCodes.add(parentCode);
  }

  if (item.rowType === 'part' && code) {
    const ck = code.toLowerCase();
    if (ctx.seenPartCodes.has(ck)) {
      throw new Error('Дублирующийся код части в файле');
    }
    ctx.seenPartCodes.add(ck);
    if (groupCode && ck === groupCode.toLowerCase()) {
      throw new Error('Код части не должен совпадать с кодом группы');
    }
  }

  if (item.rowType === 'single' && code) {
    const ck = code.toLowerCase();
    if (ctx.seenSingleCodes.has(ck)) {
      throw new Error('Дублирующийся код в файле');
    }
    ctx.seenSingleCodes.add(ck);
  }

  if (!dryRun) {
    await ensureCatalogNames(client, lookups, item);
  }

  const loc = resolveLocationFromNames(lookups, item);
  if (item.object_name && !loc.object_id && dryRun) {
    ctx.autoCreate.objects.add(item.object_name.trim());
  } else if (item.object_name && !loc.object_id) {
    throw new Error(`Объект «${item.object_name}» не найден`);
  }
  if (item.warehouse_name && !loc.warehouse_id && dryRun) {
    ctx.autoCreate.warehouses.add(item.warehouse_name.trim());
  } else if (item.warehouse_name && !loc.warehouse_id) {
    throw new Error(`Склад «${item.warehouse_name}» не найден`);
  }
  if (item.rack_name && !loc.rack_id && dryRun) {
    ctx.autoCreate.racks.add(item.rack_name.trim());
  } else if (item.rack_name && !loc.rack_id) {
    throw new Error(`Стеллаж «${item.rack_name}» не найден`);
  }

  if (!dryRun) {
    const validated = await ctx.validateLocation(client, loc);
    if (validated.error) throw new Error(validated.error);
  }

  if (item.category_name?.trim() && !dryRun) {
    const ck = item.category_name.trim().toLowerCase();
    if (!lookups.categories.get(ck)) {
      throw new Error(`Категория «${item.category_name}» не найдена`);
    }
  } else if (item.category_name?.trim() && dryRun) {
    const ck = item.category_name.trim().toLowerCase();
    if (!lookups.categories.get(ck)) ctx.autoCreate.categories.add(item.category_name.trim());
  }

  if (item.rowType === 'part') {
    let parentId = ctx.groupIdByCode.get(groupCode.toLowerCase());
    if (!parentId) {
      const inDb = await findGroupByCode(client, groupCode);
      if (inDb) {
        parentId = inDb.id;
        ctx.groupIdByCode.set(groupCode.toLowerCase(), parentId);
      }
    }
    if (!parentId && !ctx.groupsInFile.has(groupCode.toLowerCase())) {
      throw new Error(`Группа «${groupCode}» не найдена (добавьте строку «группа»)`);
    }
    if (code) {
      const ex = await findByCode(client, code);
      if (ex && !ex.parent_material_id) {
        throw new Error(`Код «${code}» занят заголовком группы`);
      }
      if (ex && ex.parent_material_id && parentId && ex.parent_material_id !== parentId) {
        throw new Error(`Код «${code}» принадлежит другой группе`);
      }
    }
  }

  return { loc };
}

async function resolveImportAction(client, item, ctx) {
  if (item.rowType === 'group') {
    const parentCode = (item.code || item.group_code || '').trim();
    const existing = await findByCode(client, parentCode);
    if (existing?.parent_material_id) {
      throw new Error(`Код «${parentCode}» уже используется частью`);
    }
    return { kind: 'group', action: existing ? 'update' : 'create' };
  }

  if (item.rowType === 'part') {
    const groupCode = (item.group_code || '').trim();
    let parentId = ctx.groupIdByCode.get(groupCode.toLowerCase());
    if (!parentId) parentId = (await findGroupByCode(client, groupCode))?.id;
    if (!parentId && !ctx.groupsInFile.has(groupCode.toLowerCase())) {
      throw new Error(`Группа «${groupCode}» не найдена`);
    }
    const partCode = item.code?.trim();
    let existing = partCode ? await findByCode(client, partCode) : null;
    if (!existing && item.part_index) {
      existing = await findPartByParentIndex(client, parentId, item.part_index);
    }
    return { kind: 'part', action: existing ? 'update' : 'create' };
  }

  const code = item.code?.trim();
  const existing = code ? await findByCode(client, code) : null;
  if (existing?.parent_material_id) {
    throw new Error(`Код «${code}» — часть группы; укажите тип «часть»`);
  }
  if (existing && await materialHasParts(client, existing.id)) {
    return { kind: 'group', action: 'update' };
  }
  return { kind: 'single', action: existing ? 'update' : 'create' };
}

/** Предпросмотр импорта без записи материалов */
export async function previewMaterialsImport(client, items, lookups, validateLocation) {
  const ctx = {
    ...buildImportContext(items),
    groupIdByCode: new Map(),
    seenGroupCodes: new Set(),
    seenPartCodes: new Set(),
    seenSingleCodes: new Set(),
    validateLocation,
    autoCreate: { objects: new Set(), warehouses: new Set(), racks: new Set(), categories: new Set() },
  };

  const warnings = [];
  let toCreate = 0;
  let toUpdate = 0;
  let groupsCreate = 0;
  let groupsUpdate = 0;
  let partsCreate = 0;
  let partsUpdate = 0;
  let singlesCreate = 0;
  let singlesUpdate = 0;

  const sorted = [...items].sort((a, b) => {
    const order = { group: 0, part: 1, single: 2 };
    return (order[a.rowType] ?? 2) - (order[b.rowType] ?? 2);
  });

  for (const item of sorted) {
    try {
      await validateImportItem(client, lookups, item, ctx, { dryRun: true });

      if (item.rowType === 'group') {
        const parentCode = (item.code || item.group_code || '').trim();
        const existing = await findByCode(client, parentCode);
        if (existing?.parent_material_id) throw new Error(`Код «${parentCode}» уже часть другой группы`);
        if (existing) {
          groupsUpdate += 1;
          ctx.groupIdByCode.set(parentCode.toLowerCase(), existing.id);
        } else {
          groupsCreate += 1;
        }
      } else {
        const { kind, action } = await resolveImportAction(client, item, ctx);
        if (kind === 'part') {
          if (action === 'create') partsCreate += 1;
          else partsUpdate += 1;
        } else if (kind === 'single') {
          if (action === 'create') singlesCreate += 1;
          else singlesUpdate += 1;
        } else if (kind === 'group') {
          if (action === 'create') groupsCreate += 1;
          else groupsUpdate += 1;
        }
      }
    } catch (e) {
      warnings.push({
        row: item.rowNum,
        code: item.code || item.group_code || '',
        error: e.message || 'Ошибка',
      });
    }
  }

  toCreate = groupsCreate + partsCreate + singlesCreate;
  toUpdate = groupsUpdate + partsUpdate + singlesUpdate;

  const autoCreateNotes = [];
  for (const n of ctx.autoCreate.objects) autoCreateNotes.push(`объект «${n}»`);
  for (const n of ctx.autoCreate.warehouses) autoCreateNotes.push(`склад «${n}»`);
  for (const n of ctx.autoCreate.racks) autoCreateNotes.push(`стеллаж «${n}»`);
  for (const n of ctx.autoCreate.categories) autoCreateNotes.push(`категория «${n}»`);

  return {
    total: items.length,
    toCreate,
    toUpdate,
    groupsCreate,
    groupsUpdate,
    partsCreate,
    partsUpdate,
    singlesCreate,
    singlesUpdate,
    autoCreate: autoCreateNotes,
    warnings,
    canImport: warnings.length === 0 && items.length > 0,
  };
}

export async function importMaterialsFromExcel(client, {
  items,
  userId,
  lookups,
  validateLocation,
  uniqueCode,
}) {
  const result = {
    created: 0,
    updated: 0,
    created_groups: 0,
    updated_groups: 0,
    created_parts: 0,
    updated_parts: 0,
    errors: [],
  };

  const ctx = {
    ...buildImportContext(items),
    groupIdByCode: new Map(),
    seenGroupCodes: new Set(),
    seenPartCodes: new Set(),
    seenSingleCodes: new Set(),
    validateLocation,
    autoCreate: { objects: new Set(), warehouses: new Set(), racks: new Set(), categories: new Set() },
  };

  const bump = (kind, isNew) => {
    if (kind === 'group') {
      if (isNew) { result.created_groups += 1; result.created += 1; }
      else { result.updated_groups += 1; result.updated += 1; }
    } else if (kind === 'part') {
      if (isNew) { result.created_parts += 1; result.created += 1; }
      else { result.updated_parts += 1; result.updated += 1; }
    } else if (isNew) result.created += 1;
    else result.updated += 1;
  };

  async function resolveCategory(item) {
    if (!item.category_name?.trim()) return null;
    const ck = item.category_name.trim().toLowerCase();
    const catId = lookups.categories.get(ck) ?? null;
    if (!catId) throw new Error(`Категория «${item.category_name}» не найдена`);
    return catId;
  }

  async function resolveLocValidated(item) {
    await validateImportItem(client, lookups, item, ctx, { dryRun: false });
    const loc = resolveLocationFromNames(lookups, item);
    const validated = await validateLocation(client, loc);
    if (validated.error) throw new Error(validated.error);
    return validated;
  }

  async function rememberGroup(code, id) {
    ctx.groupIdByCode.set(String(code).trim().toLowerCase(), id);
  }

  async function getGroupId(groupCode) {
    const k = String(groupCode).trim().toLowerCase();
    if (ctx.groupIdByCode.has(k)) return ctx.groupIdByCode.get(k);
    const row = await findGroupByCode(client, groupCode);
    if (row) {
      await rememberGroup(groupCode, row.id);
      return row.id;
    }
    return null;
  }

  async function applyQuantityChange(materialId, oldQty, newQty, note) {
    const delta = newQty - oldQty;
    if (Math.abs(delta) <= 1e-9) return;
    await logQuantityChange(client, {
      materialId,
      userId,
      delta,
      quantityAfter: newQty,
      kind: 'import',
      note,
    });
  }

  async function importGroup(item) {
    const parentCode = (item.code || item.group_code || '').trim();
    if (!parentCode) throw new Error('Укажите код группы');

    const validated = await resolveLocValidated(item);
    const catId = await resolveCategory(item);
    const priceVal = parseFloat(item.price) || 0;
    const prodPrice = parseFloat(item.production_price) || 0;

    const existing = await findByCode(client, parentCode);
    if (existing?.parent_material_id) {
      throw new Error(`Код «${parentCode}» уже используется частью другой группы`);
    }

    const hasPartsInFile = ctx.groupsWithPartsInFile.has(parentCode.toLowerCase());
    const hasPartsInDb = existing ? await materialHasParts(client, existing.id) : false;
    let parentQty = 0;
    if (!hasPartsInFile && !hasPartsInDb) {
      parentQty = parseFloat(item.quantity) || 0;
      if (existing && parentQty === 0) {
        parentQty = parseFloat(existing.quantity) || 0;
      }
    }

    if (existing) {
      await client.query(
        `UPDATE materials SET
          name = $1, unit = $2, price = $3, production_price = $4, quantity = $5,
          object_id = $6, warehouse_id = $7, rack_id = $8, category_id = $9,
          parent_material_id = NULL, part_index = NULL, part_label = NULL,
          updated_at = NOW()
         WHERE id = $10`,
        [
          item.name, item.unit, priceVal, prodPrice, parentQty,
          validated.object_id, validated.warehouse_id, validated.rack_id, catId,
          existing.id,
        ],
      );
      await rememberGroup(parentCode, existing.id);
      bump('group', false);
      return;
    }

    const ins = await client.query(
      `INSERT INTO materials (
        code, name, unit, price, production_price, quantity,
        object_id, warehouse_id, rack_id, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        parentCode, item.name, item.unit, priceVal, prodPrice, parentQty,
        validated.object_id, validated.warehouse_id, validated.rack_id, catId,
      ],
    );
    await rememberGroup(parentCode, ins.rows[0].id);
    bump('group', true);
  }

  async function importPart(item) {
    const groupCode = (item.group_code || '').trim();
    if (!groupCode) throw new Error('Укажите код группы для части');

    let parentId = await getGroupId(groupCode);
    if (!parentId) {
      throw new Error(`Группа с кодом «${groupCode}» не найдена (сначала строка «группа»)`);
    }

    if (!(await materialHasParts(client, parentId))) {
      await client.query('UPDATE materials SET quantity = 0, updated_at = NOW() WHERE id = $1', [parentId]);
    }

    const parentRow = (await client.query('SELECT name FROM materials WHERE id = $1', [parentId])).rows[0];
    const partName = item.name?.trim() || parentRow?.name || 'Часть';

    const validated = await resolveLocValidated(item);
    const catId = await resolveCategory(item);
    const priceVal = parseFloat(item.price) || 0;
    const prodPrice = parseFloat(item.production_price) || 0;
    const qty = parseFloat(item.quantity) || 0;

    let partIndex = item.part_index;
    if (!partIndex) partIndex = await nextPartIndex(client, parentId);

    const partLabel = item.part_label?.trim() || `Часть ${partIndex}`;
    const partCodeRaw = item.code?.trim();
    let existing = partCodeRaw ? await findByCode(client, partCodeRaw) : null;
    if (!existing && partIndex) {
      existing = await findPartByParentIndex(client, parentId, partIndex);
    }

    if (existing && existing.parent_material_id && existing.parent_material_id !== parentId) {
      throw new Error(`Код «${partCodeRaw || partIndex}» принадлежит другой группе`);
    }
    if (existing && !existing.parent_material_id) {
      throw new Error(`Код «${partCodeRaw}» занят заголовком группы`);
    }

    if (existing) {
      const prev = (await client.query('SELECT quantity FROM materials WHERE id = $1', [existing.id])).rows[0];
      const oldQty = parseFloat(prev?.quantity || 0);
      await client.query(
        `UPDATE materials SET
          name = $1, unit = $2, price = $3, production_price = $4, quantity = $5,
          object_id = $6, warehouse_id = $7, rack_id = $8, category_id = $9,
          parent_material_id = $10, part_index = $11, part_label = $12, updated_at = NOW()
         WHERE id = $13`,
        [
          partName, item.unit, priceVal, prodPrice, qty,
          validated.object_id, validated.warehouse_id, validated.rack_id, catId,
          parentId, partIndex, partLabel,
          existing.id,
        ],
      );
      await applyQuantityChange(existing.id, oldQty, qty, 'Импорт Excel (часть)');
      bump('part', false);
      return;
    }

    let partCode = partCodeRaw;
    if (!partCode) partCode = await uniqueCode(client);
    else if (await findByCode(client, partCode)) {
      partCode = await uniqueCode(client);
    }

    const ins = await client.query(
      `INSERT INTO materials (
        code, name, unit, price, production_price, quantity,
        object_id, warehouse_id, rack_id, category_id,
        parent_material_id, part_index, part_label
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id`,
      [
        partCode, partName, item.unit, priceVal, prodPrice, qty,
        validated.object_id, validated.warehouse_id, validated.rack_id, catId,
        parentId, partIndex, partLabel,
      ],
    );
    if (qty > 0) {
      await applyQuantityChange(ins.rows[0].id, 0, qty, 'Импорт Excel (новая часть)');
    }
    bump('part', true);
  }

  async function importSingle(item) {
    const validated = await resolveLocValidated(item);
    const catId = await resolveCategory(item);
    const priceVal = parseFloat(item.price) || 0;
    const prodPrice = parseFloat(item.production_price) || 0;
    const qty = parseFloat(item.quantity) || 0;
    const code = item.code?.trim();

    const existing = code ? await findByCode(client, code) : null;

    if (existing?.parent_material_id) {
      throw new Error(`Код «${code}» — это часть группы; укажите тип «часть»`);
    }

    if (existing && await materialHasParts(client, existing.id)) {
      await client.query(
        `UPDATE materials SET
          name = $1, unit = $2, price = $3, production_price = $4, quantity = 0,
          object_id = $5, warehouse_id = $6, rack_id = $7, category_id = $8, updated_at = NOW()
         WHERE id = $9`,
        [
          item.name, item.unit, priceVal, prodPrice,
          validated.object_id, validated.warehouse_id, validated.rack_id, catId,
          existing.id,
        ],
      );
      bump('group', false);
      return;
    }

    if (existing) {
      const prev = (await client.query('SELECT quantity FROM materials WHERE id = $1', [existing.id])).rows[0];
      const oldQty = parseFloat(prev?.quantity || 0);
      await client.query(
        `UPDATE materials SET
          name = $1, unit = $2, price = $3, production_price = $4, quantity = $5,
          object_id = $6, warehouse_id = $7, rack_id = $8, category_id = $9,
          parent_material_id = NULL, part_index = NULL, part_label = NULL,
          updated_at = NOW()
         WHERE id = $10`,
        [
          item.name, item.unit, priceVal, prodPrice, qty,
          validated.object_id, validated.warehouse_id, validated.rack_id, catId,
          existing.id,
        ],
      );
      await applyQuantityChange(existing.id, oldQty, qty, 'Импорт Excel');
      bump('single', false);
      return;
    }

    let newCode = code || await uniqueCode(client);
    if (code) {
      const clash = await findByCode(client, newCode);
      if (clash) newCode = await uniqueCode(client);
    }

    const ins = await client.query(
      `INSERT INTO materials (
        code, name, unit, price, production_price, quantity,
        object_id, warehouse_id, rack_id, category_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        newCode, item.name, item.unit, priceVal, prodPrice, qty,
        validated.object_id, validated.warehouse_id, validated.rack_id, catId,
      ],
    );
    if (qty > 0) {
      await applyQuantityChange(ins.rows[0].id, 0, qty, 'Импорт Excel (новый)');
    }
    bump('single', true);
  }

  const sorted = [...items].sort((a, b) => {
    const order = { group: 0, part: 1, single: 2 };
    return (order[a.rowType] ?? 2) - (order[b.rowType] ?? 2);
  });

  for (const item of sorted) {
    try {
      if (item.rowType === 'group') await importGroup(item);
      else if (item.rowType === 'part') await importPart(item);
      else await importSingle(item);
    } catch (e) {
      result.errors.push({
        row: item.rowNum,
        code: item.code || item.group_code || '',
        error: e.message || 'Ошибка',
      });
    }
  }

  return result;
}
