const readIndexes = async (collection) => {
  try { return await collection.listIndexes().toArray(); }
  catch (error) {
    if (error.code === 26 || error.codeName === "NamespaceNotFound") return [];
    throw error;
  }
};

// Query-performance index with the exact key order. Any existing index with the
// same key pattern is reused, whatever its name or options.
export async function ensureIndex(collection, keys) {
  const pattern = JSON.stringify(Object.entries(keys));
  const matching = (indexes) => indexes.find((index) => JSON.stringify(Object.entries(index.key)) === pattern);
  const existing = matching(await readIndexes(collection));
  if (existing) return existing.name;
  try {
    return await collection.createIndex(keys);
  } catch (error) {
    if ([85, 86].includes(error.code)) {
      const concurrent = matching(await readIndexes(collection));
      if (concurrent) return concurrent.name;
    }
    throw error;
  }
}

// Older deployments used custom index names. Compare the actual key and
// constraints rather than asking MongoDB to rename an equivalent index.
export async function ensureUniqueIndex(collection, field, name, { sparse = false } = {}) {
  const matching = (indexes) => indexes.find((index) =>
    Object.keys(index.key).length === 1 && index.key[field] === 1 &&
    index.unique === true && Boolean(index.sparse) === sparse && !index.partialFilterExpression);
  const existing = matching(await readIndexes(collection));
  if (existing) return existing.name;
  try {
    return await collection.createIndex({ [field]: 1 }, { name, unique: true, ...(sparse ? { sparse: true } : {}) });
  } catch (error) {
    // Another server may have created an equivalent index after our read.
    // Never ignore incompatible constraints, duplicate data, or access errors.
    if ([85, 86].includes(error.code)) {
      const concurrent = matching(await readIndexes(collection));
      if (concurrent) return concurrent.name;
    }
    throw error;
  }
}
