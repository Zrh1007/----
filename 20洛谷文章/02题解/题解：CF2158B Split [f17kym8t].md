---
title: "题解：CF2158B Split"
source: "luogu"
source_url: "https://www.luogu.com.cn/article/f17kym8t"
luogu_id: "f17kym8t"
published: "2026-01-05 14:14"
original_category: "题解"
original_status: "被打回"
tags: ["来源/洛谷", "主题/综合"]
---

# 子序列分割问题

## 问题描述
给定一个大小为 $2n$ 的子序列，我们必须将其分割成两个子序列 $p$ 和 $q$，每个大小为 $n$。对于任意一个总出现频率为 $cnt$ 的值，设 $u$ 和 $v$ 分别为它在 $p$ 和 $q$ 中的出现次数，满足 $u + v = cnt$。该值的贡献定义为：

$$
(u \bmod 2) + (v \bmod 2),
$$

因此可能为 $0$、$1$ 或 $2$。

## 值分类
将不同的值按 $cnt$ 分类如下：

- $x = \#\{cnt \text{ 为奇数}\}$,
- $y = \#\{cnt \equiv 2 \pmod{4}\}$,
- $z = \#\{cnt \equiv 0 \pmod{4}\}$。

## 理论最大得分
理论最大可能得分为：

$$
x + 2y + 2z。
$$

### 分类讨论
1.  **对于 $cnt$ 为奇数的值**：$u$ 或 $v$ 中必有一个为奇数，因此贡献恒为 $1$。
2.  **对于 $cnt = 4k + 2$ 的值**：选择 $u = v = 2k + 1$ 可得到贡献 $2$，同时保持 $p$ 和 $q$ 的大小平衡。
3.  **对于 $cnt = 4k$ 的值**：一种贡献为 $2$ 的分割方式是 $(u, v) = (2k + 1, 2k - 1)$，但这会导致大小不平衡 $\pm 2$。

## 可达性分析
- 若 $z$ 为偶数，这些不平衡会相互抵消。
- 若 $x > 0$，我们可以利用一个奇频率值来修复剩余的不平衡，且不影响得分。

因此，**当 $x > 0$ 或 $z$ 为偶数时**，理论最大值是可实现的：

$$
x + 2y + 2z。
$$

### 特殊情况：$x = 0$ 且 $z$ 为奇数
此时所有频率均为偶数：

- 对于 $cnt = 4k + 2$ 的值，奇分割 $u = v = 2k + 1$ 给出大小差 $0 \pmod{4}$。
- 对于 $cnt = 4k$ 的值，任何奇分割均给出大小差 $2 \pmod{4}$。

对所有值求和：

$$
\sum_i (u_i - v_i) \equiv 2z \pmod{4}。
$$

由于 $z$ 为奇数，上式同余于 $2$，这与 $|p| = |q|$ 矛盾。因此，必须有一个值的贡献为 $0$ 而非 $2$，导致总分减少 $2$。

因此，**当 $x = 0$ 且 $z$ 为奇数时**，最大得分为：

$$
x + 2y + 2z - 2。
$$

## 最终答案
综上所述，最终最大得分公式为：

$$
\text{最大得分} =
\begin{cases}
x + 2y + 2z, & \text{若 } x > 0 \text{ 或 } z \text{ 为偶数}, \\
x + 2y + 2z - 2, & \text{若 } x = 0 \text{ 且 } z \text{ 为奇数}。
\end{cases}
$$

## 时间复杂度
每个测试用例的时间复杂度为 $O(n)$。

## 代码
```cpp
#include<bits/stdc++.h>
using namespace std;

void solve(){
    int n;
    cin >> n;
    vector<int> a(2*n);
    for(int i = 0;i < 2*n;i++){
        cin >> a[i];
    }

    vector<int> cnt(2*n+1);
    for(auto &x : a)cnt[x]++;

    int x = 0,y = 0,z = 0;
    for(int i = 1;i <= 2*n;i++){
        if(cnt[i] == 0)continue; 
        if(cnt[i]&1)x++;       
        else if(cnt[i]%4)y++;  
        else z++;       
    }

    int ans = x+2*y+2*z;
    if((z&1) && x == 0)ans -= 2; 
    cout << ans << "\n";
}

int main(){
    ios_base::sync_with_stdio(0);
    cin.tie(0);
    cout.tie(0);
    int t;
    cin >> t;
    while(t--){
        solve();
    }
}
```
