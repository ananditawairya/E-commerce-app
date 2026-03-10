const { Kind, getOperationAST, parse } = require('graphql');

const INTROSPECTION_ROOT_FIELDS = new Set(['__schema', '__type']);

/**
 * Builds a fragment definition map for quick lookup.
 * @param {import('graphql').DocumentNode} documentNode Parsed GraphQL document.
 * @return {Map<string, import('graphql').FragmentDefinitionNode>} Fragment map.
 */
function buildFragmentMap(documentNode) {
  const fragments = new Map();

  for (const definition of documentNode.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  return fragments;
}

/**
 * Collects root field names for an operation selection set.
 * This avoids false positives on nested fields like `__typename`.
 * @param {import('graphql').SelectionSetNode} selectionSet Root selection set.
 * @param {Map<string, import('graphql').FragmentDefinitionNode>} fragmentMap Fragment definitions.
 * @param {Set<string>} [visitedFragments] Cycle guard.
 * @return {Set<string>} Root field names.
 */
function collectRootFieldNames(selectionSet, fragmentMap, visitedFragments = new Set()) {
  const fieldNames = new Set();

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      fieldNames.add(selection.name.value);
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      for (const fieldName of collectRootFieldNames(
        selection.selectionSet,
        fragmentMap,
        visitedFragments
      )) {
        fieldNames.add(fieldName);
      }
      continue;
    }

    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (visitedFragments.has(fragmentName)) {
        continue;
      }

      const fragmentDefinition = fragmentMap.get(fragmentName);
      if (!fragmentDefinition) {
        continue;
      }

      visitedFragments.add(fragmentName);
      for (const fieldName of collectRootFieldNames(
        fragmentDefinition.selectionSet,
        fragmentMap,
        visitedFragments
      )) {
        fieldNames.add(fieldName);
      }
    }
  }

  return fieldNames;
}

/**
 * Determines whether the request contains a root-level introspection query.
 * @param {string} query GraphQL query document.
 * @param {string|undefined} operationName GraphQL operation name.
 * @return {boolean} True when the operation introspects the schema.
 */
function isIntrospectionOperation(query, operationName) {
  let documentNode;
  try {
    documentNode = parse(query, { noLocation: true });
  } catch (error) {
    return false;
  }

  const operationNode = getOperationAST(documentNode, operationName || null);
  if (!operationNode) {
    return false;
  }

  const fragmentMap = buildFragmentMap(documentNode);
  const rootFieldNames = collectRootFieldNames(operationNode.selectionSet, fragmentMap);

  for (const fieldName of rootFieldNames) {
    if (INTROSPECTION_ROOT_FIELDS.has(fieldName)) {
      return true;
    }
  }

  return false;
}

/**
 * Validates incoming GraphQL request payload.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next callback.
 * @return {void}
 */
function validateGraphQLRequest(req, res, next) {
  const { query, operationName } = req.body;

  if (!query) {
    res.status(400).json({ error: 'GraphQL query is required' });
    return;
  }

  if (typeof query !== 'string') {
    res.status(400).json({ error: 'Query must be a string' });
    return;
  }

  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (!isDevelopment && isIntrospectionOperation(query, operationName)) {
    res.status(403).json({ error: 'Introspection queries are not allowed in production' });
    return;
  }

  next();
}

module.exports = {
  validateGraphQLRequest,
  isIntrospectionOperation,
};
