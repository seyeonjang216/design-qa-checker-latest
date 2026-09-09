#!/usr/bin/env python3
"""
로컬 전용 빌드 스크립트.

Figma 플러그인 메인 스레드는 번들러 없이는 require()/import로 다른 파일을 불러올 수
없어서, code.js는 결국 "한 개의 실제 파일"이어야 합니다. 하지만 SPACING_TOKEN_MAP에는
디자인 시스템의 진짜 변수 id가 들어가는데 이 저장소는 공개(Public) 저장소라 그 값을
git에 커밋할 수 없습니다.

그래서 로직은 code.src.js(git 추적 대상, 민감 데이터 없음)에 두고, 이 스크립트를 로컬에서
실행하면 tokenMap.local.js(git에 안 올라가는 로컬 전용 파일)가 있을 때만 그 내용을 끼워 넣어
실제로 Figma가 읽는 code.js(마찬가지로 git에 안 올라감)를 생성합니다.
tokenMap.local.js가 없으면 SPACING_TOKEN_MAP은 빈 값이 되고, 간격 체커는 "raw 값 fail"
판정은 그대로 하되 토큰 제안만 못 하는 상태로 동작합니다.

사용법: python3 build-local.py
"""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_PATH = os.path.join(BASE_DIR, "code.src.js")
TOKEN_MAP_PATH = os.path.join(BASE_DIR, "tokenMap.local.js")
OUT_PATH = os.path.join(BASE_DIR, "code.js")

MARKER = "// __SPACING_TOKEN_MAP_INJECT__\nconst SPACING_TOKEN_MAP = {};"


def main():
    with open(SRC_PATH, encoding="utf-8") as f:
        src = f.read()

    if MARKER not in src:
        raise SystemExit(
            "code.src.js에서 삽입 위치 마커를 찾지 못했습니다. "
            "누군가 마커 줄을 수정했을 수 있어요:\n" + MARKER
        )

    if os.path.exists(TOKEN_MAP_PATH):
        with open(TOKEN_MAP_PATH, encoding="utf-8") as f:
            token_map_code = f.read().strip()
        replacement = token_map_code
        status = "tokenMap.local.js 값을 반영했습니다."
    else:
        replacement = (
            "// tokenMap.local.js가 없어 매핑 없음 상태로 생성되었습니다.\n"
            "const SPACING_TOKEN_MAP = {};"
        )
        status = "tokenMap.local.js가 없어 SPACING_TOKEN_MAP을 빈 값으로 생성했습니다."

    output = src.replace(MARKER, replacement)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(output)

    print("code.js 생성 완료 —", status)


if __name__ == "__main__":
    main()
