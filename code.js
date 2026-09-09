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
  spacingTokenCollection: "V4/Spacing",
  v4ComponentLibraryKey: "dummy-v4-key",
  marketingComponentLibraryKey: "dummy-marketing-key",
  requiredPluginDataKeys: ["url", "cxmId"],
  namingPattern: "^[A-Z][a-zA-Z0-9]+(\\d+)?$",
};

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
// 각 체커는 (node, rules) => { status: 'pass' | 'warn' | 'fail', message: string } 형태의 함수입니다.
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
      const category = CHECK_CATEGORIES.find((c) => c.id === checker.categoryId);

      results.push({
        id: node.id,
        name: node.name,
        type: node.type,
        depth: depth, // 피그마 레이어 패널처럼 상위/하위를 들여쓰기로 표시하기 위한 깊이
        categoryLabel: category ? category.label : checker.categoryId,
        status: outcome.status,
        message: outcome.message,
      });
    });
  });

  return results;
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
