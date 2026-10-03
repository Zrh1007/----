#include<bits/stdc++.h>
using namespace std;
int n;
long long a[100010];
int main(){
    ios::sync_with_stdio(0),cin.tie(0),cout.tie(0);
    cin>>n;
    for(int i=0;i<n;i++)cin>>a[i];
    sort(a,a+n);
    long long ans=1e9;
   //1.最小两数+最大数
    ans=min(ans,(a[0]+a[1])*a[n-1]);
   //2.最大两数+最小数
    ans=min(ans,(a[n-1]+a[n-2])*a[0]);
   //3.前三小
    for(int i=0;i<min(3,n);i++){
        for(int j=i+1;j<min(3,n);j++){
            for(int k=j+1;k<min(3,n);k++){
                ans=min(ans,(a[i]+a[j])*a[k]);
                ans=min(ans,(a[i]+a[k])*a[j]);
                ans=min(ans,(a[j]+a[k])*a[i]);
            }
        }
    }          
   //4.前三大
    for(int i=max(0,n-3);i<n;i++){
        for(int j=i+1;j<n;j++){
            for(int k=j+1;k<n;k++){
                ans=min(ans,(a[i]+a[j])*a[k]);
                ans=min(ans,(a[i]+a[k])*a[j]);
                ans=min(ans,(a[j]+a[k])*a[i]);
            }
        }
    }
    cout<<ans;
    return 0;
}