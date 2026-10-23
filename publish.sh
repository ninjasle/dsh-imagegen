#!/usr/bin/env bash
# 把仓库发布到 GitHub。两种用法：
#
#   1) 有 token（推荐，能顺便建仓）：
#        GH_TOKEN=ghp_xxx ./publish.sh <你的GitHub用户名> [仓库名]
#
#   2) 仓库已经在 GitHub 上建好了（网页建、或 gh repo create 建过）：
#        ./publish.sh <用户名> [仓库名]      # 用 SSH 推，需已配好 ssh key
#
# 环境变量：
#   GH_TOKEN   有则走 HTTPS + API 建仓；没有则走 git@github.com SSH 推送
#   PRIVATE    1 = 建私有仓库（默认 public）
set -euo pipefail

USER_NAME="${1:-}"
REPO="${2:-dsh-imagegen}"
[ -z "$USER_NAME" ] && { echo "用法: $0 <GitHub用户名> [仓库名]" >&2; exit 2; }

cd "$(dirname "$0")"

# 清掉 package.json 里的占位符
python3 - "$USER_NAME" "$REPO" <<'PY'
import io, json, sys
user, repo = sys.argv[1], sys.argv[2]
d = json.load(io.open('package.json', encoding='utf-8'))
url = f'https://github.com/{user}/{repo}'
d['author'] = {'name': user, 'url': f'https://github.com/{user}'}
d['repository'] = {'type': 'git', 'url': url + '.git'}
d['homepage'] = url + '#readme'
d['bugs'] = {'url': url + '/issues'}
io.open('package.json', 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
PY

python3 - "$USER_NAME" "$REPO" <<'PY'
import io, sys
user, repo = sys.argv[1], sys.argv[2]
p = 'README.md'
s = io.open(p, encoding='utf-8').read()
s = s.replace('YOUR-USERNAME', user)
io.open(p, 'w', encoding='utf-8').write(s)
PY

# LICENSE 署名
sed -i "s|<YOUR NAME>|$USER_NAME|" LICENSE

git add -A
git -c user.name="$USER_NAME" -c user.email="$USER_NAME@users.noreply.github.com" \
    commit -q -m "chore: 填写仓库元信息（作者 / repository / homepage / LICENSE）" || echo "（无改动可提交）"

if [ -n "${GH_TOKEN:-}" ]; then
  visibility="public"; [ "${PRIVATE:-0}" = "1" ] && visibility="private"
  echo "==> 用 API 创建仓库 $USER_NAME/$REPO ($visibility)"
  code=$(curl -s -o /tmp/gh-create.json -w '%{http_code}' \
    -X POST https://api.github.com/user/repos \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$REPO\",\"description\":\"DeepSeek Harness 文生图插件：generate_image 工具 + 输入框按钮 + 设置页\",\"private\":$([ "$visibility" = private ] && echo true || echo false)}")
  if [ "$code" != "201" ] && [ "$code" != "422" ]; then
    echo "建仓失败 HTTP $code:"; cat /tmp/gh-create.json; exit 1
  fi
  [ "$code" = "422" ] && echo "（仓库已存在，直接推）"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://$USER_NAME:$GH_TOKEN@github.com/$USER_NAME/$REPO.git"
  git push -u origin main
  # 推完把 token 从 remote 里抹掉，别留在 .git/config
  git remote set-url origin "https://github.com/$USER_NAME/$REPO.git"
  echo "==> 完成：https://github.com/$USER_NAME/$REPO"
else
  git remote remove origin 2>/dev/null || true
  git remote add origin "git@github.com:$USER_NAME/$REPO.git"
  echo "==> 推送到 SSH 远端（需仓库已存在）"
  git push -u origin main
  echo "==> 完成：https://github.com/$USER_NAME/$REPO"
fi
