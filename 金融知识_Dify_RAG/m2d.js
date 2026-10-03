import fs from 'node:fs/promises'
import path from 'node:path'

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { toString } from 'mdast-util-to-string'

/**
 * =========================
 * 配置
 * =========================
 */

const CONFIG = {
  // Markdown：
  // ## xxx  -> Parent
  // ### xxx -> Child
  parentLevel: 2,
  childLevel: 3,

  // Dify 自定义分隔符
  parentSeparator: '<<<DIFY_PARENT>>>',
  childSeparator: '<<<DIFY_CHILD>>>',

  // Child 是否携带父级标题
  //
  // true:
  // 算力 > GPU
  //
  // false:
  // GPU
  includeParentContext: false,

  // 更深层标题 #### / ##### 是否保留
  keepDeeperHeadings: true,

  // 是否保留一级标题 #
  keepTopLevelHeadings: true,
}

/**
 * =========================
 * Markdown AST
 * =========================
 */

function parseMarkdown(markdown) {
  return unified()
    .use(remarkParse)
    .parse(markdown)
}

/**
 * 获取节点纯文本
 *
 * 例如：
 *
 * **Blackwell**
 *      ↓
 * Blackwell
 *
 * [NVIDIA](https://nvidia.com)
 *      ↓
 * NVIDIA
 */
function nodeToText(node) {
  return toString(node).trim()
}

/**
 * 清理文本
 */
function cleanText(text) {
  return text
    // Windows 换行
    .replace(/\r\n/g, '\n')

    // 多个空格
    .replace(/[ \t]+/g, ' ')

    // 过多空行
    .replace(/\n{3,}/g, '\n\n')

    .trim()
}

/**
 * =========================
 * Markdown → Dify
 * =========================
 */

function convertMarkdownToDify(markdown) {
  const tree = parseMarkdown(markdown)

  const parents = []

  let currentParent = null
  let currentChild = null

  function createParent(title = '') {
    const parent = {
      title,
      content: [],
      children: [],
    }

    parents.push(parent)

    currentParent = parent
    currentChild = null

    return parent
  }

  function createChild(title) {
    if (!currentParent) {
      createParent()
    }

    const child = {
      title,
      content: [],
    }

    currentParent.children.push(child)
    currentChild = child

    return child
  }

  /**
   * 添加普通正文
   */
  function appendContent(text) {
    text = cleanText(text)

    if (!text) {
      return
    }

    if (currentChild) {
      currentChild.content.push(text)
      return
    }

    if (currentParent) {
      currentParent.content.push(text)
      return
    }

    // 文档开始没有 ## 时
    createParent()
    currentParent.content.push(text)
  }

  for (const node of tree.children) {

    /**
     * =========================
     * ## Parent
     * =========================
     */

    if (
      node.type === 'heading' &&
      node.depth === CONFIG.parentLevel
    ) {
      createParent(nodeToText(node))
      continue
    }

    /**
     * =========================
     * ### Child
     * =========================
     */

    if (
      node.type === 'heading' &&
      node.depth === CONFIG.childLevel
    ) {
      createChild(nodeToText(node))
      continue
    }

    /**
     * =========================
     * #### / ##### ...
     * =========================
     */

    if (
      node.type === 'heading' &&
      node.depth > CONFIG.childLevel
    ) {
      if (CONFIG.keepDeeperHeadings) {
        appendContent(nodeToText(node))
      }

      continue
    }

    /**
     * =========================
     * # 一级标题
     * =========================
     */

    if (
      node.type === 'heading' &&
      node.depth < CONFIG.parentLevel
    ) {
      if (CONFIG.keepTopLevelHeadings) {
        appendContent(nodeToText(node))
      }

      continue
    }

    /**
     * =========================
     * 普通 Markdown block
     * =========================
     */

    const text = nodeToText(node)

    if (text) {
      appendContent(text)
    }
  }

  /**
   * =========================
   * 生成 Dify 文本
   * =========================
   */

  const output = []

  for (const parent of parents) {

    /**
     * Parent separator
     */
    output.push(CONFIG.parentSeparator)

    /**
     * Parent 标题
     */
    if (parent.title) {
      output.push(parent.title)
    }

    /**
     * Parent 正文
     */
    if (parent.content.length) {
      output.push(
        parent.content.join('\n\n')
      )
    }

    /**
     * Child
     */
    for (const child of parent.children) {

      output.push(CONFIG.childSeparator)

      /**
       * Parent 上下文
       */
      if (
        CONFIG.includeParentContext &&
        parent.title
      ) {
        output.push(parent.title)
        output.push('>')
      }

      /**
       * Child 标题
       */
      output.push(child.title)

      /**
       * Child 正文
       */
      if (child.content.length) {
        output.push(
          child.content.join('\n\n')
        )
      }
    }
  }

  return cleanText(output.join('\n\n'))
}

/**
 * =========================
 * 文件处理
 * =========================
 */

async function convertFile(inputFile) {
  const markdown = await fs.readFile(
    inputFile,
    'utf8'
  )

  const result = convertMarkdownToDify(
    markdown
  )

  const outputFile = path.join(
    path.dirname(inputFile),
    `${path.basename(
      inputFile,
      path.extname(inputFile)
    )}.dify.txt`
  )

  await fs.writeFile(
    outputFile,
    result,
    'utf8'
  )

  console.log('')
  console.log('✓ 转换完成')
  console.log('')
  console.log(`输入:  ${inputFile}`)
  console.log(`输出:  ${outputFile}`)
  console.log('')
  console.log('Dify 分隔符:')
  console.log(`Parent: ${CONFIG.parentSeparator}`)
  console.log(`Child : ${CONFIG.childSeparator}`)
  console.log('')
}

/**
 * =========================
 * CLI
 * =========================
 */

async function main() {
  const inputFile = process.argv[2]

  if (!inputFile) {
    console.error('')
    console.error(
      '用法: node md-to-dify.js <markdown文件>'
    )
    console.error('')
    console.error(
      '例如: node md-to-dify.js ./docs/ai.md'
    )
    console.error('')

    process.exit(1)
  }

  try {
    await convertFile(inputFile)
  } catch (error) {
    console.error('')
    console.error('✗ 转换失败')
    console.error('')

    if (error.code === 'ENOENT') {
      console.error(
        `找不到文件: ${inputFile}`
      )
    } else {
      console.error(error)
    }

    console.error('')

    process.exit(1)
  }
}

main()