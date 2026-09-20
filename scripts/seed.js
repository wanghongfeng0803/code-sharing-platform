'use strict';

const { db } = require('../src/db');

const samples = [
  {
    title: '快速排序（Python 实现）',
    author: 'alice',
    language: 'python',
    description: '经典分治算法，平均时间复杂度 O(n log n)',
    tags: ['算法', '排序', 'python'],
    content: `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

print(quicksort([3, 6, 1, 8, 2, 9, 4]))`,
  },
  {
    title: 'Express 健康检查接口',
    author: 'bob',
    language: 'javascript',
    description: '一个最简单的 Express GET 接口示例',
    tags: ['express', 'nodejs', 'web'],
    content: `const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(3000, () => console.log('listening on 3000'));`,
  },
  {
    title: 'Go 并发爬虫 worker pool',
    author: 'gopher',
    language: 'go',
    description: '使用 channel 实现固定数量 worker 的并发任务池',
    tags: ['go', '并发', 'channel'],
    content: `package main

import (
\t"fmt"
\t"sync"
)

func worker(id int, jobs <-chan int, results chan<- int, wg *sync.WaitGroup) {
\tdefer wg.Done()
\tfor job := range jobs {
\t\tfmt.Printf("worker %d processing job %d\\n", id, job)
\t\tresults <- job * job
\t}
}

func main() {
\tjobs := make(chan int, 10)
\tresults := make(chan int, 10)
\tvar wg sync.WaitGroup
\tfor w := 1; w <= 3; w++ {
\t\twg.Add(1)
\t\tgo worker(w, jobs, results, &wg)
\t}
\tfor j := 1; j <= 5; j++ {
\t\tjobs <- j
\t}
\tclose(jobs)
\twg.Wait()
\tclose(results)
}`,
  },
  {
    title: 'Rust 读取文件并统计行数',
    author: 'rustacean',
    language: 'rust',
    description: '? 错误传播运算符与迭代器适配器示例',
    tags: ['rust', 'io', '迭代器'],
    content: `use std::fs;
use std::io;

fn count_lines(path: &str) -> io::Result<usize> {
    let content = fs::read_to_string(path)?;
    Ok(content.lines().count())
}

fn main() {
    match count_lines("Cargo.toml") {
        Ok(n) => println!("{} lines", n),
        Err(e) => eprintln!("error: {}", e),
    }
}`,
  },
  {
    title: '二分查找（C 语言）',
    author: 'carol',
    language: 'c',
    description: '有序数组上的迭代版二分查找',
    tags: ['算法', '查找', 'c'],
    content: `#include <stdio.h>

int binary_search(const int *arr, int n, int target) {
    int lo = 0, hi = n - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (arr[mid] == target) return mid;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

int main(void) {
    int arr[] = {1, 3, 5, 7, 9, 11};
    printf("%d\\n", binary_search(arr, 6, 7));
    return 0;
}`,
  },
  {
    title: 'TypeScript 泛型防抖函数',
    author: 'dave',
    language: 'typescript',
    description: '类型安全的 debounce 工具函数',
    tags: ['typescript', '泛型', '工具函数'],
    content: `function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

const onInput = debounce((value: string) => {
  console.log('search:', value);
}, 300);`,
  },
  {
    title: 'JSON 配置文件示例',
    author: 'ops',
    language: 'json',
    description: '一份典型的服务配置',
    tags: ['json', '配置'],
    content: `{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "tls": false
  },
  "features": ["highlight", "search", "rate-limit"],
  "limits": { "maxUploadKb": 300 }
}`,
  },
  {
    title: 'SQLite 建表语句',
    author: 'dba',
    language: 'sql',
    description: '代码片段表的建表 SQL（以纯文本保存展示）',
    tags: ['sql', 'sqlite'],
    content: `CREATE TABLE snippets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  content TEXT NOT NULL,
  views INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_created ON snippets(created_at DESC);`,
  },
];

const insert = db.prepare(`
  INSERT OR IGNORE INTO snippets
    (id, title, author, language, content, description, tags, views, created_at, updated_at)
  VALUES
    (@id, @title, @author, @language, @content, @description, @tags, @views, @created_at, @updated_at)
`);

const crypto = require('crypto');
const now = Date.now();
let count = 0;

for (const [index, sample] of samples.entries()) {
  const result = insert.run({
    id: crypto.randomBytes(9).toString('base64url'),
    title: sample.title,
    author: sample.author,
    language: sample.language === 'sql' ? 'plaintext' : sample.language,
    content: sample.content,
    description: sample.description,
    tags: sample.tags.join(','),
    views: Math.floor(Math.random() * 200),
    created_at: now - index * 60_000,
    updated_at: now - index * 60_000,
  });
  count += result.changes;
}

console.log(`种子数据写入完成：新增 ${count} 条`);
process.exit(0);
