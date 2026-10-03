---
title: "题解：AT1202Contest_h Incomplete Notes"
source: "luogu"
source_url: "https://www.luogu.com.cn/article/fkt62v47"
luogu_id: "fkt62v47"
published: "2025-07-31 09:59"
original_category: "题解"
original_status: "公开"
tags: ["来源/洛谷", "主题/搜索"]
---

#### 题意简述

给定序列 $A$ 和 $B$，问有多少个长度为 $M$ 的 $A$ 的连续子区间 $C$，可以通过如下操作让 $C$ 和 $B$ 完全一样：

1. 把 $B$ 和 $C$ 里所有为 $0$ 的元素随便换成任意正实数（可以都一样也可以不一样，随你开心）。
2. 对 $C$ 的所有元素乘以任意正实数 $t$。

#### 条件分析

- $B$ 和 $C$ 的所有 $0$ 都能变成任意正实数，所以 $0$ 的位置不用管啦。
- 非零位置，$B$ 和 $C$ 必须都不是 $0$，否则没法通过乘法和替换得到。
- 非零位置，$C$ 和 $B$ 的比例必须一致，也就是说得有个 $t$，让 $C_j \times t = B_j$，也就是 $C_j / B_j = 1/t$，所有非零位置的 $C_j / B_j$ 都要一样才行。

#### 算法步骤

1. 先预处理 $B$，把所有非零位置的下标和对应值都记下来。
2. 枚举 $A$ 的所有长度为 $M$ 的子区间 $C$，每个区间都要：
    - 检查所有 $B$ 的非零位置，$C$ 对应位置也不能是 $0$，否则不行。
    - 计算所有 $C_j / B_j$（$B_j \neq 0$），必须都一样才行。
3. 满足条件的区间就计数。

#### 代码实现

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    int n, m;
    cin >> n >> m;
    vector<int> A(n), B(m);
    for (int i = 0; i < n; ++i) cin >> A[i];
    for (int i = 0; i < m; ++i) cin >> B[i];

    // 预处理 B 的非零位置
    vector<pair<int, int>> non_zero_B;
    for (int i = 0; i < m; ++i) {
        if (B[i] != 0) {
            non_zero_B.emplace_back(i, B[i]);
        }
    }

    int count = 0;

    // 枚举 A 的所有长度为 m 的子区间
    for (int start = 0; start <= n - m; ++start) {
        bool valid = true;
        double ratio = 0.0;

        for (const auto& [j, b_val] : non_zero_B) {
            int idx = start + j;
            if (A[idx] == 0) {
                valid = false;
                break;
            }
            double current_ratio = static_cast<double>(A[idx]) / b_val;
            if (ratio == 0.0) {
                ratio = current_ratio; // 初始化比例
            } else if (fabs(current_ratio - ratio) > 1e-9) {
                valid = false; // 比例不一致
                break;
            }
        }

        if (valid) {
            count++;
        }
    }

    cout << count << endl;
    return 0;
}
```
