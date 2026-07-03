#include<bits/stdc++.h>
using namespace std;

int n;
long long k,a[100005],ans;
set<long long>s;

bool check(long long x){
    if(x>0&&x>LLONG_MAX/k) return 0;
    if(x<0&&x<LLONG_MIN/k) return 0;
    return s.count(x*k);
}

int main(){
    ios::sync_with_stdio(0),cin.tie(0),cout.tie(0);
    //freopen(".in","r",stdin);
    //freopen(".out","w",stdout);
    cin>>n>>k;
    for(int i=1;i<=n;i++){
        cin>>a[i];
        s.insert(a[i]);
    }
    for(int i=1;i<=n;i++){
        if(a[i]%k==0&&s.count(a[i]/k)) continue;
        int len=1;
        long long x=a[i];
        while(check(x)){
            len++;
            x*=k;
        }
        ans+=(len+1)/2;
    }
    cout<<ans;
    return 0;
}
