---
title: "并查集"
source: "luogu"
source_url: "https://www.luogu.com.cn/article/lizdzqo8"
luogu_id: "lizdzqo8"
published: "2025-11-25 13:50"
original_category: "算法·理论"
original_status: "被打回"
tags: ["来源/洛谷", "主题/数据结构", "主题/数学"]
identical_sources: ["20洛谷文章/01算法笔记/数据结构/11.22并查集总结 [s2wqpxpr].md"]
---

# 并查集
![并查集示意图](../../../80%E9%99%84%E4%BB%B6/image-7bd9bffcb82cfa6e.svg)
## 引入

> [!info]+ 并查集
>
>  并查集（Union-Find）是一种数据结构，用于处理一些不交集的合并及查询问题。它支持两种主要操作：合并（union）和查找（find）。并查集常用于网络连接问题、群组划分等场景。


## 基本操作

### 1. 初始化
> 创建一个包含 n 个元素的并查集，每个元素自成一个集合。
> ```cpp
> p[i] = i; // 初始化时每个元素的父节点指向自己
> ```
### 2. 查找（Find）
> 查找元素所在集合的代表（根节点）。
> ![查找示意图](../../../80%E9%99%84%E4%BB%B6/image-89caad3a830f2f87.svg)  
> ```cpp
> int find(int x){
>	if(p[x]==x) return x;
>	return find(p[x]);
> }
> ```
> 查询过程中经过的每个元素都属于该集合，我们可以将其直接连到根节点以加快后续查询
> ![路径压缩示意图](../../../80%E9%99%84%E4%BB%B6/image-8648639ba432ed3b.svg)
> ```cpp
> int find(int x){
>	if(p[x]==x) return x;
>	return p[x]=find(p[x]);// 路径压缩
> }
> ```
### 3. 合并（Union）
> 将两个元素所在的集合合并为一个集合。具体的，将一个集合的根节点指向另一个集合的根节点。
> ![合并示意图](../../../80%E9%99%84%E4%BB%B6/image-3b1e7b4fe24f1769.svg)
> ```cpp
> void union(int x,int y){
>	int t1=find(x);
>	int t2=find(y);
>	if(t1!=t2) p[t2]=t1; // 一定要判断是否已经在同一个集合中
> }
> ```

## 例题

### T696738 数字小队
#### 简化题意
> - 有一个区间 [a, b]，初始时每个整数都是独立的集合
> - 如果两个数字有 ≥ k 的公共质因数，则将它们合并为一个集合
> - 问最终有多少个独立的集合

#### 思路
> - 使用并查集维护集合的合并
> - 预处理区间内每个数的质因数
> - 对于每个质因数，将所有包含该质因数的数合并为一个集合
> - 最后统计有多少个独立的集合

#### 代码实现
```cpp
#include<bits/stdc++.h>
using namespace std;
int p[500010],a,b,k;
int find(int x){
	if(p[x]==x) return x;
	return p[x]=find(p[x]);
}
void union(int x,int y){
	int t1=find(x);
	int t2=find(y);
	if(t1!=t2) p[t2]=t1;
}
bool ip(int x){
	if(x==2) return 1;
	if(x%2==0) return 0;
	for(int i=3;i*i<=x;i++){
		if(x%i==0) return 0;
	}
	return 1;
}
int main(){
	cin>>a>>b>>k;
	for(int i=a;i<=b;i++) p[i]=i;
	for(int i=k;i<=b;i++){
		if(ip(i)){
			int o=-1;
			for(int j=i;j<=b;j+=i){
				if(j>=a&&j<=b){
					if(o==-1) o=j;
					else merge(o,j);
				}
			}
		}
	}
	int cnt=0;
	for(int i=a;i<=b;i++){
		if(p[i]==i) cnt++;
	}
	cout<<cnt;
	return 0;
}
```
