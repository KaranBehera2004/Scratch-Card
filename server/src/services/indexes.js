// Older deployments used custom index names. Compare the actual key and
// constraints rather than asking MongoDB to rename an equivalent index.
export async function ensureUniqueIndex(collection, field, name, { sparse = false } = {}) {
  const readIndexes = async () => {
    try { return await collection.listIndexes().toArray(); }
    catch (error) {
      if (error.code === 26 || error.codeName === "NamespaceNotFound") return [];
      throw error;
    }
  };
  const matching = (indexes) => indexes.find((index) =>
    Object.keys(index.key).length === 1 && index.key[field] === 1 &&
    index.unique === true && Boolean(index.sparse) === sparse && !index.partialFilterExpression);
  const existing = matching(await readIndexes());
  if (existing) return existing.name;
  try {
    return await collection.createIndex({ [field]: 1 }, { name, unique: true, ...(sparse ? { sparse: true } : {}) });
  } catch (error) {
    // Another server may have created an equivalent index after our read.
    // Never ignore incompatible constraints, duplicate data, or access errors.
    if ([85, 86].includes(error.code)) {
      const concurrent = matching(await readIndexes());
      if (concurrent) return concurrent.name;
    }
    throw error;
  }
}
