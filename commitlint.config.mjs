export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 描述用中文，行尾不要句号
    'subject-full-stop': [2, 'never'],
    // scope 可选，但出现时须小写短横线
    'scope-case': [2, 'always', 'lower-case']
  }
}
