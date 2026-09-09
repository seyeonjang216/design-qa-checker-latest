// ===== Design QA Checker - Phase 1 (뼈대) =====
// 이 단계에서는 실제 검사 로직은 없고, "구조"만 만듭니다.
// - 체크리스트 카테고리를 UI로 보내기
// - 선택한 프레임의 레이어를 실제로 순회하기 (진짜 데이터)
// - 임시(더미) 판정 결과를 만들어서 UI에 보여주기
// - 결과 클릭 시 캔버스에서 해당 레이어로 이동하기
// 다음 단계부터는 아래 CHECK_CATEGORIES 각 항목에 실제 검사 함수를 하나씩 연결합니다.

figma.showUI(__html__, { width: 380, height: 600 });

// ===== 디자인 시스템 규칙 값 =====
// Figma 플러그인 메인 스레드는 번들러 없이는 require()/import나 fetch로
// 로컬 파일(rules.json)을 읽어올 수 없어서(네트워크 접근도 "none"), 지금은
// rules.json의 값을 아래 RULES 객체로 그대로 미러링해서 사용합니다.
// rules.json 값을 바꾸면 이 객체도 함께 수정해주세요.
const RULES = {
  spacingTokenCollection: "spacing",
  v4ComponentLibraryKey: "dummy-v4-key",
  marketingComponentLibraryKey: "dummy-marketing-key",
  requiredPluginDataKeys: ["url", "cxmId"],
  namingPattern: "^[A-Z][a-zA-Z0-9]+(\\d+)?$",
};

// ===== 간격 토큰 매핑표 (픽셀 값 → 토큰 정보) =====
// 실제 값은 디자인 시스템의 진짜 변수 id가 담긴 민감한 데이터라 이 파일(git 추적 대상)에는
// 넣지 않습니다. build-local.py를 실행하면 tokenMap.local.js(git에 안 올라가는 로컬 전용
// 파일)의 내용이 아래 자리에 끼워진 code.js가 생성됩니다. tokenMap.local.js가 없으면
// 빈 매핑으로 생성되어, 간격 체커는 raw 값 fail 판정은 그대로 하되 "토큰 제안"만 못 합니다.
// __SPACING_TOKEN_MAP_INJECT__
const SPACING_TOKEN_MAP = {};

const CHECK_CATEGORIES = [
  { id: "component-usage", label: "마케팅/V4 컴포넌트 구분" },
  { id: "spacing-token", label: "간격 V4 토큰 사용" },
  { id: "layer-naming", label: "레이어 네이밍 규칙" },
  { id: "url-cxm", label: "URL / CXM ID 지정" },
  { id: "dark-mode", label: "다크모드 대응" },
  { id: "header-type", label: "Header 종류 (팝업/풀페이지)" },
  { id: "footer-sticky", label: "Footer sticky 여부" },
  { id: "responsive", label: "가로/세로 리사이즈 대응" },
];

// UI가 준비되면 카테고리 목록을 먼저 보내줍니다.
figma.ui.postMessage({ type: "init", categories: CHECK_CATEGORIES });

figma.ui.onmessage = (msg) => {
  if (msg.type === "run-check") {
    runCheck();
  }
  if (msg.type === "select-layer") {
    selectLayer(msg.nodeId);
  }
  if (msg.type === "apply-token-fix") {
    applyTokenFix(msg);
  }
};

function runCheck() {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: "error",
      message: "검사할 프레임을 캔버스에서 먼저 선택해주세요.",
    });
    return;
  }

  const layerEntries = [];
  selection.forEach((rootNode) => {
    collectLayers(rootNode).forEach((entry) => layerEntries.push(entry));
  });

  const results = runAllCheckers(layerEntries, RULES);

  figma.ui.postMessage({ type: "results", results });
}

// ===== 체커 레지스트리 =====
// 각 체커는 (node, rules) => result 형태의 함수입니다. result는
// { status: 'pass' | 'warn' | 'fail', message: string, property?, suggestedTokenName?, suggestedVariableId? }
// 객체 하나이거나, 그런 객체들의 배열이어도 됩니다(한 노드에서 여러 속성을
// 각각 검사해야 하는 spacingTokenChecker처럼 결과가 여러 개 나올 수 있는 경우).
// categoryId는 CHECK_CATEGORIES의 id와 매칭되어 UI에 표시할 categoryLabel을 결정합니다.
// appliesTo(node, meta)는 선택 사항입니다. 없으면 모든 레이어에 적용되고,
// false를 리턴하면 그 체커는 해당 노드를 건너뜁니다.
// meta = { depth, isRoot } — depth는 collectLayers가 매긴 트리 깊이,
// isRoot는 사용자가 캔버스에서 직접 선택한 최상위 노드인지 여부입니다.

function dummyNamingChecker(node, rules) {
  // ⚠️ 실제 검사 로직이 아니라, 체커 등록/실행 구조가 잘 동작하는지 확인하기 위한 더미 체커입니다.
  const pattern = new RegExp(rules.namingPattern);
  const passed = pattern.test(node.name);

  return {
    status: passed ? "pass" : "warn",
    message: passed
      ? `(더미 체커) 레이어명이 네이밍 규칙(${rules.namingPattern})과 일치합니다.`
      : `(더미 체커) 레이어명이 네이밍 규칙(${rules.namingPattern})과 일치하지 않습니다.`,
  };
}

// URL / CXM ID 체커: 사용자가 직접 선택한 최상위 노드에만 적용됩니다.
// (하위 레이어까지 다 검사하면 의미가 없는 값이라 루트 한정)
function urlCxmChecker(node, rules) {
  const requiredKeys = rules.requiredPluginDataKeys;

  const missingKeys = requiredKeys.filter((key) => {
    const value = node.getPluginData(key);
    return !value;
  });

  if (missingKeys.length > 0) {
    return {
      status: "fail",
      message: `${missingKeys.join(", ")}이(가) 지정되지 않았습니다.`,
    };
  }

  return {
    status: "pass",
    message: `${requiredKeys.join(", ")}가 모두 지정되어 있습니다.`,
  };
}

// 반응형(가로/세로 리사이즈) 대응 체커: FRAME/COMPONENT/INSTANCE/COMPONENT_SET에만 적용됩니다.
function responsiveChecker(node, rules) {
  const horizontalFixed = node.constraints && node.constraints.horizontal === "FIXED";
  const verticalFixed = node.constraints && node.constraints.vertical === "FIXED";

  if (horizontalFixed && verticalFixed) {
    return {
      status: "fail",
      message: "가로/세로 constraints가 모두 FIXED로 설정되어 있어 리사이즈에 대응하지 않습니다.",
    };
  }

  // layoutSizingHorizontal/Vertical은 부모가 Auto Layout일 때만 의미가 있는 값입니다.
  const parentIsAutoLayout =
    node.parent &&
    (node.parent.layoutMode === "HORIZONTAL" || node.parent.layoutMode === "VERTICAL");

  if (
    parentIsAutoLayout &&
    node.layoutSizingHorizontal === "FIXED" &&
    node.layoutSizingVertical === "FIXED"
  ) {
    return {
      status: "fail",
      message: "Auto Layout 안에서 가로/세로 sizing이 모두 FIXED로 설정되어 있어 리사이즈에 대응하지 않습니다.",
    };
  }

  return {
    status: "pass",
    message: "리사이즈 대응 설정이 확인되었습니다.",
  };
}

// 간격(spacing) 체커: Auto Layout 프레임의 itemSpacing/padding이 변수에
// 연결되어 있는지 확인합니다. raw 값이면 fail이고, SPACING_TOKEN_MAP에서
// 정확히 같은 픽셀 값의 토큰을 찾으면 suggestedTokenName/suggestedVariableId를
// 함께 실어줍니다(못 찾으면 두 필드 다 넣지 않습니다).
// 값이 0이고 변수에 연결도 안 돼 있으면 "그냥 안 쓴 것"(디자이너가 일부러
// 토큰을 뺀 게 아니라 애초에 간격/패딩이 필요 없는 레이어)일 확률이 매우 높아서
// 검사 대상에서 제외합니다 — 안 그러면 아이콘 래퍼 같은 구조용 프레임까지 전부
// "위반"으로 잡혀서 진짜 문제를 찾기 어려워집니다. 이미 토큰에 연결되어 있는
// 속성(문제 없음)은 결과에 아예 넣지 않습니다 — "이미 연결되어 있습니다" 같은
// 확인용 pass 메시지가 속성 개수(최대 5개)만큼 계속 쌓여서 노이즈가 심했습니다.
// 결과에 안 뜨는 것 자체가 "그 속성은 문제없다"는 뜻입니다.
const SPACING_PROPERTIES = ["itemSpacing", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom"];

function spacingTokenChecker(node, rules) {
  const results = [];

  SPACING_PROPERTIES.forEach((property) => {
    // itemSpacing은 자식이 2개 이상이어야 화면에 실제로 영향을 줍니다.
    // (자식이 0~1개면 값이 뭐든 아무 차이가 없어서 검사할 의미가 없음)
    if (property === "itemSpacing" && (!node.children || node.children.length < 2)) {
      return;
    }

    const value = node[property];
    if (typeof value !== "number") return;

    const isBound = !!(node.boundVariables && node.boundVariables[property]);

    if (isBound) {
      // 이미 토큰에 연결되어 있음 = 문제 없음 → 노이즈를 줄이기 위해 결과에 넣지 않음
      return;
    }

    if (value === 0) {
      // 연결 안 된 raw 0 — 노이즈라서 결과에 아예 넣지 않음
      return;
    }

    const suggestion = SPACING_TOKEN_MAP[value];
    const result = {
      status: "fail",
      property: property,
      value: value, // UI가 "제안: {토큰명} ({value}px)" 문구를 만들 때 사용
      message: `${property} 값(${value}px)이 토큰에 연결되지 않은 raw 값입니다.`,
    };

    if (suggestion) {
      result.suggestedTokenName = suggestion.tokenName;
      result.suggestedVariableId = suggestion.variableId;
    }

    results.push(result);
  });

  return results;
}

const CHECKERS = [
  { id: "dummy-naming-checker", categoryId: "layer-naming", check: dummyNamingChecker },
  {
    id: "url-cxm-checker",
    categoryId: "url-cxm",
    appliesTo: (node, meta) => meta.isRoot,
    check: urlCxmChecker,
  },
  {
    id: "responsive-checker",
    categoryId: "responsive",
    appliesTo: (node) =>
      node.type === "FRAME" ||
      node.type === "COMPONENT" ||
      node.type === "INSTANCE" ||
      node.type === "COMPONENT_SET",
    check: responsiveChecker,
  },
  {
    id: "spacing-token-checker",
    categoryId: "spacing-token",
    appliesTo: (node) => node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL",
    check: spacingTokenChecker,
  },
];

function runAllCheckers(layerEntries, rules) {
  const results = [];

  layerEntries.forEach(({ node, depth }) => {
    const meta = { depth, isRoot: depth === 0 };

    CHECKERS.forEach((checker) => {
      if (checker.appliesTo && !checker.appliesTo(node, meta)) {
        return;
      }

      const outcome = checker.check(node, rules);
      const outcomes = Array.isArray(outcome) ? outcome : [outcome];
      const category = CHECK_CATEGORIES.find((c) => c.id === checker.categoryId);

      outcomes.forEach((o) => {
        const result = {
          id: node.id,
          name: node.name,
          type: node.type,
          depth: depth, // 피그마 레이어 패널처럼 상위/하위를 들여쓰기로 표시하기 위한 깊이
          categoryLabel: category ? category.label : checker.categoryId,
          status: o.status,
          message: o.message,
        };

        if (o.property) result.property = o.property;
        if (typeof o.value === "number") result.value = o.value;
        if (o.suggestedTokenName) result.suggestedTokenName = o.suggestedTokenName;
        if (o.suggestedVariableId) result.suggestedVariableId = o.suggestedVariableId;

        results.push(result);
      });
    });
  });

  return results;
}

// "V4/Spacing" 같은 팀 라이브러리 컬렉션 이름 + 토큰 이름(예: "spacing-sem/125")으로
// 그 변수의 실제 "key"(importVariableByKeyAsync가 요구하는 값. variableId와는 다른 값)를
// 찾습니다. 라이브러리가 이 파일의 Assets에 활성화되어 있어야 하고,
// manifest.json에 "permissions": ["teamlibrary"]가 있어야 동작합니다.
async function findLibraryVariableKeyByName(collectionName, variableName) {
  if (!figma.teamLibrary || typeof figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync !== "function") {
    return { key: null, reason: "figma.teamLibrary API를 사용할 수 없음 (manifest permissions 확인 필요)" };
  }

  let collections;
  try {
    collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  } catch (e) {
    return { key: null, reason: "라이브러리 컬렉션 목록 조회 실패: " + (e && e.message ? e.message : String(e)) };
  }

  const collection = collections.find((c) => c.name === collectionName);
  if (!collection) {
    const availableNames = collections.map((c) => c.name).join(", ") || "(이 파일에 활성화된 라이브러리 컬렉션이 하나도 없음)";
    return {
      key: null,
      reason:
        '"' +
        collectionName +
        '" 라이브러리 컬렉션을 찾을 수 없음. 이 파일에서 실제로 활성화된 컬렉션: [' +
        availableNames +
        "] — rules.json의 spacingTokenCollection 값을 이 중 정확한 이름으로 맞춰주세요.",
    };
  }

  let variables;
  try {
    variables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key);
  } catch (e) {
    return { key: null, reason: "라이브러리 변수 목록 조회 실패: " + (e && e.message ? e.message : String(e)) };
  }

  const match = variables.find((v) => v.name === variableName);
  if (!match) {
    return { key: null, reason: '"' + collectionName + '" 안에서 "' + variableName + '" 변수를 찾지 못함' };
  }

  return { key: match.key, reason: null };
}

// variableId(+ tokenName)로 실제 Variable 객체를 가져오려고 시도합니다.
// 1) getVariableByIdAsync: 이 파일에 로컬로 있거나 이미 임포트된 변수면 바로 됩니다.
// 2) 팀 라이브러리에서 토큰 이름으로 실제 key를 찾아 importVariableByKeyAsync로 임포트
//    (라이브러리 변수를 처음 쓰는 경우 이 경로가 진짜 성공 경로입니다).
// 3) (마지막 시도) variableId를 key로 직접 넣어보기 — 대부분 실패하지만 혹시 몰라 시도.
// 각 시도의 실제 실패 사유를 attempts에 모아서 리턴합니다 — 뭉뚱그린 메시지 대신
// Figma가 실제로 뱉는 에러를 그대로 UI/콘솔에서 볼 수 있게 하기 위함입니다.
async function resolveVariable(variableId, tokenName, rules) {
  const attempts = [];

  if (typeof figma.variables.getVariableByIdAsync === "function") {
    try {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (variable) return { variable: variable, attempts: attempts };
      attempts.push("getVariableByIdAsync → null (이 파일에서 해당 id의 변수를 찾지 못함)");
    } catch (e) {
      attempts.push("getVariableByIdAsync 에러: " + (e && e.message ? e.message : String(e)));
    }
  } else {
    attempts.push("getVariableByIdAsync API를 사용할 수 없음");
  }

  if (tokenName && rules && rules.spacingTokenCollection) {
    const lookup = await findLibraryVariableKeyByName(rules.spacingTokenCollection, tokenName);

    if (lookup.key) {
      try {
        const variable = await figma.variables.importVariableByKeyAsync(lookup.key);
        if (variable) return { variable: variable, attempts: attempts };
        attempts.push("importVariableByKeyAsync(라이브러리 key) → null");
      } catch (e) {
        attempts.push("importVariableByKeyAsync(라이브러리 key) 에러: " + (e && e.message ? e.message : String(e)));
      }
    } else {
      attempts.push("팀 라이브러리 조회 실패: " + lookup.reason);
    }
  }

  if (typeof figma.variables.importVariableByKeyAsync === "function") {
    try {
      const variable = await figma.variables.importVariableByKeyAsync(variableId);
      if (variable) return { variable: variable, attempts: attempts };
      attempts.push("importVariableByKeyAsync(variableId) → null");
    } catch (e) {
      attempts.push("importVariableByKeyAsync(variableId) 에러: " + (e && e.message ? e.message : String(e)));
    }
  } else {
    attempts.push("importVariableByKeyAsync API를 사용할 수 없음");
  }

  return { variable: null, attempts: attempts };
}

async function applyTokenFix(msg) {
  const { nodeId, property, variableId, tokenName } = msg;
  const node = figma.getNodeById(nodeId);

  if (!node) {
    figma.ui.postMessage({
      type: "apply-token-fix-result",
      nodeId: nodeId,
      property: property,
      tokenName: tokenName,
      success: false,
      message: "레이어를 찾을 수 없습니다. 캔버스가 바뀌었거나 레이어가 삭제되었을 수 있어요.",
    });
    return;
  }

  try {
    const resolved = await resolveVariable(variableId, tokenName, RULES);

    if (!resolved.variable) {
      throw new Error(resolved.attempts.join(" / "));
    }

    node.setBoundVariable(property, resolved.variable);

    figma.ui.postMessage({
      type: "apply-token-fix-result",
      nodeId: nodeId,
      property: property,
      tokenName: tokenName,
      success: true,
    });
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);

    // 좁은 UI 패널에 다 안 보일 수 있으니 Figma 플러그인 콘솔에도 그대로 남깁니다.
    console.error("[apply-token-fix] 실패:", { nodeId, property, variableId, tokenName, detail });

    figma.ui.postMessage({
      type: "apply-token-fix-result",
      nodeId: nodeId,
      property: property,
      tokenName: tokenName,
      success: false,
      message: "자동 적용은 실패했습니다. 토큰명을 복사해서 Figma에서 직접 연결해주세요. (" + detail + ")",
    });
  }
}

function selectLayer(nodeId) {
  const node = figma.getNodeById(nodeId);
  if (node && "x" in node) {
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }
}

function collectLayers(node, acc, depth) {
  const isRoot = !acc;
  if (!acc) acc = [];
  if (depth === undefined) depth = 0;

  // 사용자가 직접 선택한 최상위 프레임(isRoot)은 숨김 여부와 상관없이 검사합니다.
  // 그 외(자식 레이어)는 visible이 false면 자신과 그 하위 레이어를 통째로 건너뜁니다.
  if (!isRoot && node.visible === false) {
    return acc;
  }

  acc.push({ node, depth });

  if ("children" in node) {
    getLayerPanelOrderedChildren(node).forEach((child) =>
      collectLayers(child, acc, depth + 1)
    );
  }
  return acc;
}

// 레이어 패널에 보이는 위→아래 순서로 자식을 정렬합니다.
// - 일반(절대 위치) 노드: children[0]이 맨 아래, 마지막 요소가 맨 위이므로 뒤에서부터 순회.
// - Auto Layout 프레임에서 itemReverseZIndex가 true면, 배열 순서 그대로가
//   캔버스 맨 위 = 레이어 패널 맨 위이므로 뒤집지 않습니다.
function getLayerPanelOrderedChildren(node) {
  const children = node.children;
  const isAutoLayout = node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
  const matchesArrayOrder = isAutoLayout && node.itemReverseZIndex === true;

  return matchesArrayOrder ? children.slice() : children.slice().reverse();
}
