#include<bits/stdc++.h>
using namespace std;

const int N=2e5+5;
int fa[N];
int n,m;

int find(int x){
    if(fa[x]==x) return x;
    else return fa[x]=find(fa[x]);
}

int main(){
    ios::sync_with_stdio(0),cin.tie(0),cout.tie(0);
    cin>>n>>m;
    for(int i=1;i<=n;i++) fa[i]=i;
    for(int i=1;i<=m;i++){
        int op,x,y;
        cin>>op>>x>>y;
        if(op==1){
            x=find(x),y=find(y);
            if(x==y) continue;
            fa[x]=y;
        }
        else{
            x=find(x),y=find(y);
            if(x==y) cout<<"Y\n";
            else cout<<"N\n";
        }
    }
    return 0;
}